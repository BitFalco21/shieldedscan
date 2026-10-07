/**
 * A thin client over OpenAI-compatible chat completions (OpenRouter and NEAR AI), hand-rolled:
 * it is ~150 lines of fetch and SSE parsing, every line of which we want to own when a stream
 * misbehaves.
 *
 * OpenRouter's privacy routing lives in `buildRequestBody` and nowhere else: every request
 * requires `zdr: true` (the provider does not retain the prompt at rest) AND
 * `data_collection: "deny"` (it does not train on it). A provider can satisfy one and not the
 * other, so both are mandatory.
 */

import type { InferenceProvider, ProviderId } from "./provider";

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: WireToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface WireToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface AssembledToolCall {
  id: string;
  name: string;
  arguments: string;
}

export type StreamEvent =
  | { type: "content"; text: string }
  /**
   * A `reasoning_content` delta arrived. Carries no text on purpose: a model's reasoning is never
   * the answer, the trail or the raw observer's. It exists so the stall and idle clocks in
   * `loop.ts`, which race the next parsed event, can see that a thinking model is alive rather than
   * treating a long think as a dead call.
   */
  | { type: "reasoning" }
  | {
      type: "done";
      finishReason: string | null;
      toolCalls: AssembledToolCall[];
      usage: { promptTokens: number; completionTokens: number } | null;
    };

export interface CompletionParams {
  model: string;
  messages: ChatMessage[];
  /** OpenAI-format tool definitions; empty means the model may not call tools. */
  tools: readonly unknown[];
  maxTokens: number;
}

export function buildRequestBody(
  params: CompletionParams,
  provider: ProviderId,
): Record<string, unknown> {
  const common = {
    model: params.model,
    messages: params.messages,
    // Omitted entirely when empty: an empty tools array is not the same statement as no
    // tools offered, and some providers reject it.
    ...(params.tools.length > 0 ? { tools: params.tools } : {}),
    max_tokens: params.maxTokens,
    stream: true,
  };
  // NEAR AI gets only what it honours. It answers 200 to every field below and acts on none of them,
  // so carrying them across would put unenforced privacy promises on the wire and meter the budget
  // at zero (see `provider.ts`).
  if (provider === "near-ai") {
    return {
      ...common,
      // The OpenAI spelling. `usage: { include: true }` produces no usage block here at all,
      // and the daily budget is metered from that block.
      stream_options: { include_usage: true },
      // The one reasoning control this host honours. On a reasoning model it cuts hidden thinking before
      // a tool call from hundreds of characters to almost none, with the same tool chosen; a model that
      // does not reason is unaffected. `thinking: { type: "disabled" }` is ignored, and
      // `chat_template_kwargs: { enable_thinking: false }` moves the thinking into `content` behind a
      // literal `</think>`, leaking it into the answer.
      reasoning_effort: "low",
    };
  }
  return {
    ...common,
    // The final stream chunk carries the usage block the daily budget is metered from.
    usage: { include: true },
    // Reasoning is on by default for this model and is the wrong trade here: it can consume the whole
    // output cap and truncate the answer, so this is a correctness guard as much as a cost one. The
    // thinking that matters already happened in the tool call.
    reasoning: { enabled: false },
    provider: {
      // Two separate guarantees, both mandatory: zdr means the provider does not retain
      // the prompt at rest, data_collection: "deny" means it does not train on it.
      zdr: true,
      data_collection: "deny",
      // ZDR narrows the pool, and default balancing can land on an endpoint several times pricier with
      // no cache-read price, so prompt caching never engages. Declarative rather than a pinned provider
      // name: pricing moves. The eval corpus is the gate for any quality cost of the cheaper provider.
      sort: "price",
    },
  };
}

export interface ChatClientConfig {
  apiKey: string;
  baseUrl: string;
  /** Which host's body shape to build: the hosts disagree, silently, about what they honour. */
  provider: ProviderId;
}

/** The model, abstracted so the loop tests script it and the route passes a real host. */
export type ChatStreamer = (
  params: CompletionParams,
  signal: AbortSignal,
) => AsyncGenerator<StreamEvent>;

/** A streamer bound to one inference host and its key. */
export function streamerFor(provider: InferenceProvider, apiKey: string): ChatStreamer {
  return (params, signal) =>
    streamChat({ apiKey, baseUrl: provider.baseUrl, provider: provider.id }, params, signal);
}

/**
 * One streaming completion. The caller's AbortSignal is forwarded to the fetch. That is a cost
 * control: a closed tab must cancel the completion, or opening and closing the page in a loop
 * burns budget for free.
 */
export async function* streamChat(
  config: ChatClientConfig,
  params: CompletionParams,
  signal: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildRequestBody(params, config.provider)),
    signal,
  });
  if (!res.ok || res.body === null) {
    const detail = await res.text().catch(() => "");
    throw new Error(`${config.provider} answered ${res.status}: ${detail.slice(0, 300)}`);
  }
  yield* parseSseStream(res.body);
}

interface SseChunk {
  choices?: {
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
      tool_calls?: {
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }[];
    };
    finish_reason?: string | null;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}

/**
 * Parse an OpenAI-style SSE stream: `data: {json}` events separated by blank lines,
 * `: comment` keep-alives ignored, `data: [DONE]` terminal. Content deltas are yielded
 * as they arrive; fragmented tool calls are assembled by index and delivered with the
 * final event, alongside the usage block if the provider sent one.
 */
export async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<StreamEvent> {
  const decoder = new TextDecoder();
  let buffer = "";
  let finishReason: string | null = null;
  let usage: { promptTokens: number; completionTokens: number } | null = null;
  const partials = new Map<number, AssembledToolCall>();

  const handleData = function* (payload: string): Generator<StreamEvent> {
    let parsed: SseChunk;
    try {
      parsed = JSON.parse(payload) as SseChunk;
    } catch {
      return; // a malformed keep-alive is not worth killing the stream over
    }
    if (parsed.usage != null) {
      usage = {
        promptTokens: parsed.usage.prompt_tokens ?? 0,
        completionTokens: parsed.usage.completion_tokens ?? 0,
      };
    }
    const choice = parsed.choices?.[0];
    if (choice === undefined) return;
    if (choice.finish_reason != null) finishReason = choice.finish_reason;
    const delta = choice.delta;
    if (delta?.content != null && delta.content !== "") {
      yield { type: "content", text: delta.content };
    }
    if (delta?.reasoning_content != null && delta.reasoning_content !== "") {
      yield { type: "reasoning" };
    }
    for (const frag of delta?.tool_calls ?? []) {
      const existing = partials.get(frag.index) ?? { id: "", name: "", arguments: "" };
      if (frag.id !== undefined) existing.id = frag.id;
      if (frag.function?.name !== undefined) existing.name = frag.function.name;
      if (frag.function?.arguments !== undefined) existing.arguments += frag.function.arguments;
      partials.set(frag.index, existing);
    }
  };

  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE events end at a blank line; anything after the last one may be incomplete.
      for (;;) {
        const boundary = buffer.indexOf("\n\n");
        if (boundary === -1) break;
        const event = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        for (const line of event.split("\n")) {
          if (!line.startsWith("data: ")) continue; // comments and blank lines
          const payload = line.slice("data: ".length).trim();
          if (payload === "[DONE]") continue; // the terminal marker; loop exits on EOF
          yield* handleData(payload);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  yield {
    type: "done",
    finishReason,
    toolCalls: [...partials.entries()].sort(([a], [b]) => a - b).map(([, call]) => call),
    usage,
  };
}
