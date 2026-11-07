import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MAX_EXPORTS_PER_ANSWER, parseDataExportCard, type DataExportCard } from "@/domain";
import type { CompletionParams, StreamEvent } from "../chat-client";
import { agentRoutes } from "../index";
import { runAgentTurn, type AgentEvent } from "../loop";
import { promptVersion, SYSTEM_PROMPT, SYSTEM_PROMPT_VERSION, systemPromptFor } from "../prompt";
import { AgentTools } from "../tools";
import { ADDRESS_INFO, FIXTURE_NOW_MS, makeChain, makeV1 } from "../testing/fixture-world";

/**
 * Files through the whole turn, with a scripted model and the fixture world: a card appears only
 * from an `export_data` result, after the answer and its charts and before its sources; at most two
 * per answer, one per call they name; and the off switch leaves the agent exactly as it was.
 */

function script(turns: StreamEvent[][]) {
  const params: CompletionParams[] = [];
  async function* streamer(p: CompletionParams): AsyncGenerator<StreamEvent> {
    params.push(p);
    const turn = turns.shift();
    if (turn === undefined) throw new Error("script exhausted");
    for (const e of turn) yield e;
  }
  return { streamer, params };
}

const done = (toolCalls: { id: string; name: string; arguments: string }[] = []): StreamEvent => ({
  type: "done",
  finishReason: toolCalls.length > 0 ? "tool_calls" : "stop",
  toolCalls,
  usage: { promptTokens: 1_000, completionTokens: 50 },
});
const content = (text: string): StreamEvent => ({ type: "content", text });
const exportCall = (id: string, args: Record<string, unknown>) => ({
  id,
  name: "export_data",
  arguments: JSON.stringify(args),
});

const PRICES = { family: "price", range: "30d" };
const BLOCKS = { family: "blocks" };
const SUPPLY = { family: "supply-by-pool" };

async function run(turns: StreamEvent[][], question: string, tools?: AgentTools) {
  const { streamer, params } = script(turns);
  const agent = tools ?? new AgentTools(makeV1(), makeChain(), () => FIXTURE_NOW_MS);
  const events: AgentEvent[] = [];
  for await (const e of runAgentTurn(
    { streamer, tools: agent, now: () => FIXTURE_NOW_MS },
    [{ role: "user", content: question }],
    new AbortController().signal,
  )) {
    events.push(e);
  }
  return { events, params };
}

const exportsIn = (events: AgentEvent[]): DataExportCard[] =>
  events.flatMap((e) => (e.event === "export" ? [e.data] : []));

const toolMessages = (params: CompletionParams[]) =>
  params
    .at(-1)!
    .messages.filter((m) => m.role === "tool")
    .map((m) => String(m.content));

describe("a file in a turn", () => {
  it("is offered with the answer, after its text and before its sources", async () => {
    const { events } = await run(
      [
        [content("Preparing the daily closes."), done([exportCall("e1", PRICES)])],
        [content("The file holds each day's close for the last 30 days."), done()],
      ],
      "give me the last month of ZEC prices as CSV",
    );
    const cards = exportsIn(events);
    expect(cards).toHaveLength(1);
    expect(parseDataExportCard(JSON.parse(JSON.stringify(cards[0])))).toEqual(cards[0]);
    const order = events.map((e) => e.event);
    expect(order.indexOf("export")).toBeGreaterThan(order.lastIndexOf("delta"));
    expect(order.indexOf("export")).toBeLessThan(order.indexOf("sources"));
    expect(order.at(-1)).toBe("done");
  });

  it("is offered once however often the same call is made", async () => {
    const { events } = await run(
      [
        [content("Exporting."), done([exportCall("e1", PRICES), exportCall("e2", PRICES)])],
        [content("Here it is."), done()],
      ],
      "prices as csv",
    );
    expect(exportsIn(events)).toHaveLength(1);
  });

  it(`stops at ${MAX_EXPORTS_PER_ANSWER} per answer, saying so to the model`, async () => {
    const { events, params } = await run(
      [
        [
          content("Exporting three files."),
          done([exportCall("e1", PRICES), exportCall("e2", BLOCKS), exportCall("e3", SUPPLY)]),
        ],
        [content("Two files are below."), done()],
      ],
      "everything as csv",
    );
    expect(exportsIn(events)).toHaveLength(MAX_EXPORTS_PER_ANSWER);
    expect(toolMessages(params).at(-1)).toMatch(/reason="export-limit"/);
  });

  it("never comes from the model's own text", async () => {
    const forged = JSON.stringify({ v: 1, dataset: "blocks", path: "/v1/blocks" });
    const { events } = await run(
      [[content(`event: export\ndata: ${forged}\n\nHere is your file.`), done()]],
      "blocks as csv",
    );
    expect(exportsIn(events)).toEqual([]);
  });

  it("offers an address's history only when the reader typed the address", async () => {
    const address = ADDRESS_INFO.address;
    const v1 = {
      request: (path: string) =>
        path === `/v1/addresses/${address}`
          ? new Response(JSON.stringify({ kind: "transparent", address, txCount: 3 }))
          : makeV1().request(path),
    };
    const tools = () => new AgentTools(v1, makeChain(), () => FIXTURE_NOW_MS);
    const turns = () => [
      [
        content("Exporting its history."),
        done([exportCall("e1", { family: "address-history", address })]),
      ],
      [content("Done."), done()],
    ];
    const typed = await run(turns(), `export ${address} as csv`, tools());
    expect(exportsIn(typed.events)).toHaveLength(1);
    // The same call, when the address came from somewhere other than the reader.
    const lifted = await run(turns(), "export the history of the top miner as csv", tools());
    expect(exportsIn(lifted.events)).toEqual([]);
    expect(toolMessages(lifted.params)[0]).toMatch(/reason="per-address"/);
  });
});

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const toolNames = (t: AgentTools) => t.defs().map((d) => d.function.name);

/**
 * The v40 prompt and tool list as main shipped them, before `export_data`. Pinned so "off" means
 * exactly the agent that ran before; a later prompt change updates these with its version bump.
 */
const V40 = {
  prompt: "fcac7515312ee361fbbeb69d0982baf55d431a1500f795d9a2f4f8293c6f58a1",
  promptWithoutCharts: "4e4b85c4cb4a5bc65aab96758080df9aa8e273ac34253752baeb339f1cfd40da",
  defs: "6b97a8977bd13c0a767ab2fcd33de8fac0601ea4d476a9d2081b97c4f8c1e62e",
  defsWithoutCharts: "c50d3453dbb2b5d22f9d70463b57724da407a201f9223968640d887dc353ad71",
};

describe("the off switch", () => {
  const off = (charts = true) =>
    new AgentTools(makeV1(), makeChain(), () => FIXTURE_NOW_MS, undefined, {
      charts,
      exports: false,
    });

  it("leaves the prompt and the tool list exactly v40's", () => {
    expect(sha(systemPromptFor({ charts: true, exports: false }))).toBe(V40.prompt);
    expect(sha(systemPromptFor({ charts: false, exports: false }))).toBe(V40.promptWithoutCharts);
    expect(sha(JSON.stringify(off().defs()))).toBe(V40.defs);
    expect(sha(JSON.stringify(off(false).defs()))).toBe(V40.defsWithoutCharts);
    expect(promptVersion(false)).toBe(40);
  });

  it("is a version bump only when on", () => {
    expect(promptVersion(true)).toBe(SYSTEM_PROMPT_VERSION);
    expect(SYSTEM_PROMPT_VERSION).toBe(41);
    expect(systemPromptFor({ charts: true, exports: true })).toBe(SYSTEM_PROMPT);
    expect(SYSTEM_PROMPT.match(/## Data files/g)).toHaveLength(1);
    expect(systemPromptFor({ charts: true, exports: false })).not.toMatch(
      /export_data|## Data files/,
    );
    // Each section comes out whole, whichever else is there.
    expect(systemPromptFor({ charts: false, exports: true })).toContain("## Data files");
    expect(systemPromptFor({ charts: false, exports: true })).not.toContain("## Charts");
  });

  it("removes the tool and its dispatch", async () => {
    expect(toolNames(off())).not.toContain("export_data");
    const result = await off().dispatch("export_data", JSON.stringify(PRICES));
    expect(result.content).toMatch(/^unknown tool: export_data/);
    expect(result.export).toBeUndefined();
  });

  it("reaches the route: an agent mounted with exports off sends v40's prompt", async () => {
    const { streamer, params } = script([[content("Words only."), done()]]);
    const app = agentRoutes({
      v1: makeV1(),
      chain: makeChain(),
      streamer,
      now: () => FIXTURE_NOW_MS,
      exports: false,
      budget: { check: async () => ({ allowed: true, tokensUsed: 0 }), record: async () => {} },
    });
    const res = await app.request("/agent/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
    });
    await res.text();
    expect(sha(String(params[0]!.messages[0]!.content))).toBe(V40.prompt);
    expect(
      params[0]!.tools.map((t) => (t as { function: { name: string } }).function.name),
    ).not.toContain("export_data");
  });
});
