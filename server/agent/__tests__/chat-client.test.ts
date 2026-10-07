import { describe, expect, it } from "vitest";
import { buildRequestBody, parseSseStream, type ChatMessage } from "../chat-client";
import { PROVIDERS, resolveProvider } from "../provider";

/**
 * The provider client's two pure halves. The request builder is where the privacy routing lives; a
 * test over the exact body object is the closest unit-level evidence that a field is actually on
 * the wire.
 */

const MESSAGES: ChatMessage[] = [
  { role: "system", content: "prompt" },
  { role: "user", content: "what is Ironwood?" },
];

describe("buildRequestBody", () => {
  const body = buildRequestBody(
    { model: "deepseek/deepseek-v4-pro-0813", messages: MESSAGES, tools: [], maxTokens: 800 },
    "openrouter",
  );

  it("requires ZDR routing AND no-training — separate guarantees, both mandatory", () => {
    expect(body.provider).toMatchObject({ zdr: true, data_collection: "deny" });
  });

  /**
   * ZDR narrows the provider pool, and default balancing can land on the most expensive ZDR
   * endpoint, one that publishes no cache-read price so prompt caching never engages. `sort:
   * "price"` is declarative rather than a hardcoded provider list, because pricing moves and a
   * pinned name would silently become wrong.
   */
  it("routes to the cheapest ZDR provider rather than whichever balancing picks", () => {
    expect((body.provider as Record<string, unknown>).sort).toBe("price");
  });

  /**
   * Reasoning is on by default for this model and is the wrong trade here: it can consume the whole
   * output budget (a 200-token cap spent entirely on reasoning truncates the answer), so this is a
   * correctness guard as well as a cost one.
   */
  it("disables reasoning — it eats the output budget and answers here are terse by design", () => {
    expect(body.reasoning).toEqual({ enabled: false });
  });

  it("pins the model, streams, and caps output tokens", () => {
    expect(body.model).toBe("deepseek/deepseek-v4-pro-0813");
    expect(body.stream).toBe(true);
    expect(body.max_tokens).toBe(800);
  });

  it("asks for usage in the stream — the budget is metered from it", () => {
    expect(body.usage).toEqual({ include: true });
  });

  it("omits the tools key entirely when none are offered (tool_choice none)", () => {
    expect(body.tools).toBeUndefined();
    expect(
      buildRequestBody({ model: "m", messages: MESSAGES, tools: [{}], maxTokens: 1 }, "openrouter")
        .tools,
    ).toEqual([{}]);
  });
});

/** Build a ReadableStream of SSE lines the way OpenRouter chunks them. */
function sse(...events: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const e of events) controller.enqueue(enc.encode(e));
      controller.close();
    },
  });
}

const chunk = (delta: object, extra: object = {}) =>
  `data: ${JSON.stringify({ choices: [{ delta, ...extra }] })}\n\n`;

describe("parseSseStream", () => {
  it("yields a text-free heartbeat for a reasoning_content delta, so a thinking model is not a stalled one", async () => {
    // Some NEAR-hosted models reason by default and stream it as `reasoning_content`. The stall
    // clock races the first parsed event, so a parser that ignores these chunks reads a long think
    // as a dead call. The event carries no text: reasoning never reaches the answer, the trail or
    // the raw observer.
    const stream = sse(
      `data: ${JSON.stringify({ choices: [{ delta: { content: null, reasoning_content: "The user wants" } }] })}\n\n`,
      chunk({ content: "391" }),
      chunk({}, { finish_reason: "stop" }),
      "data: [DONE]\n\n",
    );
    const events = [];
    for await (const e of parseSseStream(stream)) events.push(e);
    expect(events.map((e) => e.type)).toEqual(["reasoning", "content", "done"]);
    expect(JSON.stringify(events)).not.toContain("The user wants");
  });

  it("yields content deltas as they arrive", async () => {
    const stream = sse(
      chunk({ content: "Iron" }),
      chunk({ content: "wood" }),
      chunk({}, { finish_reason: "stop" }),
      "data: [DONE]\n\n",
    );
    const events = [];
    for await (const e of parseSseStream(stream)) events.push(e);
    expect(
      events.filter((e) => e.type === "content").map((e) => e.type === "content" && e.text),
    ).toEqual(["Iron", "wood"]);
    const done = events.at(-1);
    expect(done).toMatchObject({ type: "done", finishReason: "stop" });
  });

  it("assembles tool calls fragmented across chunks by index", async () => {
    const stream = sse(
      chunk({
        tool_calls: [
          {
            index: 0,
            id: "call_1",
            type: "function",
            function: { name: "lookup_block", arguments: "" },
          },
        ],
      }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: '{"heightOr' } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: 'Hash":"3428150"}' } }] }),
      chunk({}, { finish_reason: "tool_calls" }),
      "data: [DONE]\n\n",
    );
    const events = [];
    for await (const e of parseSseStream(stream)) events.push(e);
    const done = events.at(-1);
    expect(done).toMatchObject({
      type: "done",
      finishReason: "tool_calls",
      toolCalls: [{ id: "call_1", name: "lookup_block", arguments: '{"heightOrHash":"3428150"}' }],
    });
  });

  it("captures the usage block from the final chunk", async () => {
    const stream = sse(
      chunk({ content: "hi" }),
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1200, completion_tokens: 40 } })}\n\n`,
      "data: [DONE]\n\n",
    );
    const events = [];
    for await (const e of parseSseStream(stream)) events.push(e);
    expect(events.at(-1)).toMatchObject({
      type: "done",
      usage: { promptTokens: 1200, completionTokens: 40 },
    });
  });

  it("survives an SSE event split across transport chunks", async () => {
    const whole = chunk({ content: "split across the wire" });
    const stream = sse(whole.slice(0, 25), whole.slice(25), "data: [DONE]\n\n");
    const events = [];
    for await (const e of parseSseStream(stream)) events.push(e);
    expect(events[0]).toEqual({ type: "content", text: "split across the wire" });
  });

  it("ignores OpenRouter's processing comments", async () => {
    const stream = sse(": OPENROUTER PROCESSING\n\n", chunk({ content: "ok" }), "data: [DONE]\n\n");
    const events = [];
    for await (const e of parseSseStream(stream)) events.push(e);
    expect(events[0]).toEqual({ type: "content", text: "ok" });
  });
});

describe("the NEAR AI body", () => {
  const body = buildRequestBody(
    { model: PROVIDERS["near-ai"].model, messages: MESSAGES, tools: [], maxTokens: 1_500 },
    "near-ai",
  );

  it("asks for usage the OpenAI way — the OpenRouter spelling yields NO usage block here", () => {
    // On NEAR, `usage: { include: true }` streams with no usage block; `stream_options` produces
    // one. The daily budget is metered from that block, so the wrong spelling would meter zero and
    // leave a keyless paid endpoint unmetered.
    expect(body.stream_options).toEqual({ include_usage: true });
    expect(body.usage).toBeUndefined();
  });

  it("carries NO field this host ignores", () => {
    // NEAR answers HTTP 200 to `provider`, `reasoning` and `chat_template_kwargs` and honours none
    // of them. Sending the ZDR block anyway would leave `/privacy` promising guarantees that are
    // not on the wire.
    expect(body.provider).toBeUndefined();
    expect(body.reasoning).toBeUndefined();
  });

  it("asks for low reasoning effort, the one reasoning control NEAR honours", () => {
    // `reasoning_effort: "low"` is the one reasoning control NEAR honours for its reasoning models;
    // it cuts a tool round's latency several-fold with the same tool chosen. The alternatives fail:
    // `thinking: disabled` is ignored and `enable_thinking: false` leaks the thinking into the
    // answer text.
    expect(body.reasoning_effort).toBe("low");
    expect(body.thinking).toBeUndefined();
    expect(body.chat_template_kwargs).toBeUndefined();
  });

  it("still streams, still caps output, still omits an empty tools array", () => {
    expect(body.stream).toBe(true);
    expect(body.max_tokens).toBe(1_500);
    expect(body.tools).toBeUndefined();
  });
});

describe("resolveProvider", () => {
  it("defaults to NEAR AI — the TEE host is the point of the move", () => {
    // NEAR AI is the default. OpenRouter stays in the table as the rollback path, reachable with
    // one env var and no code change.
    expect(resolveProvider({}).id).toBe("near-ai");
    expect(resolveProvider({ AGENT_INFERENCE_PROVIDER: "openrouter" }).id).toBe("openrouter");
  });

  it("switches on the flag", () => {
    const provider = resolveProvider({ AGENT_INFERENCE_PROVIDER: "near-ai" });
    expect(provider.id).toBe("near-ai");
    expect(provider.keyEnv).toBe("NEAR_AI_API_KEY");
  });

  it("THROWS on an unrecognised value rather than falling back", () => {
    // A typo that silently kept the old host would send one vendor's key to the other and 401 every
    // question, which reads as an outage rather than a misconfiguration.
    expect(() => resolveProvider({ AGENT_INFERENCE_PROVIDER: "nearai" })).toThrow(/not a provider/);
  });

  it("keys the two hosts to different env vars", () => {
    expect(PROVIDERS.openrouter.keyEnv).not.toBe(PROVIDERS["near-ai"].keyEnv);
  });
});
