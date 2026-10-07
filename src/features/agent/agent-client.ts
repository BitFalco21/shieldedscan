/**
 * The browser half of the agent protocol: POST a conversation, read an SSE stream.
 *
 * The request goes from the visitor's browser straight to the API — this site never sees
 * it, proxies nothing and stores nothing, the same path `TryIt.tsx` takes and the reason
 * `connect-src` already carries that origin. There is no session id and no client id in
 * the payload: history is whatever the caller passes, held in a React state hook that dies
 * with the tab.
 *
 * `fetch` + `ReadableStream` rather than `EventSource`, because EventSource cannot POST.
 */

import { capitalise } from "@/lib/format";

export interface AgentTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AgentSource {
  label: string;
  href: string;
}

/** The turns already on screen, as much of one as `historyFor` needs. */
export interface PastExchange {
  question: string;
  answer: string;
}

/**
 * The most turns one request may carry. The gate's own cap is 8 (`MAX_HISTORY_MESSAGES`);
 * this is the odd number below it, so the slice can never begin on an assistant turn and
 * strand it without the question it answered.
 */
const MAX_HISTORY_TURNS = 7;

/**
 * The conversation to send with a new question.
 *
 * A past exchange is replayed only when it has an answer, and its question goes with it when it
 * does not. That is the precondition the server gate enforces (`content must be a non-empty
 * string`), and this is the only code that builds a history, so the two must agree here.
 * Otherwise a stop before the first token leaves an empty answer that, replayed, makes every
 * later question fail.
 *
 * Filtering on the text rather than the status means a future status needs no rule here. An
 * unanswered question is dropped rather than replayed alone — two user turns in a row is a shape
 * not every provider accepts. It stays on screen, where it is true; tool results are never
 * replayed either.
 */
export function historyFor(past: readonly PastExchange[], question: string): AgentTurn[] {
  const replayed = past.flatMap((e): AgentTurn[] =>
    e.answer.trim() === ""
      ? []
      : [
          { role: "user", content: e.question },
          { role: "assistant", content: e.answer },
        ],
  );
  const asked: AgentTurn = { role: "user", content: question };
  return [...replayed, asked].slice(-MAX_HISTORY_TURNS);
}

export type AgentStreamEvent =
  /**
   * `detail` is the subject of a lookup — "3428150", "7 days" — built server-side from the
   * model's own arguments and sanitised there (`describeToolCall`). The trail renders it after
   * the tool's own words.
   *
   * Optional on purpose: an API that predates it sends no such key, and the trail must lose the
   * subject rather than the row. The frontend may ship first because absence is valid.
   */
  | { event: "status"; state: "thinking" | "looking-up"; tool?: string; detail?: string }
  | { event: "delta"; text: string }
  /** Discard what has been drawn: it was preamble before a tool call, not the answer. */
  | { event: "reset" }
  /**
   * The model's own working before a tool call — sanitised, collapsed and capped server-side
   * (`narrationText`), so it is display-ready plain text. It belongs in the thinking trail,
   * never the answer: routed into `answer` it would reach the replayed history and the copy
   * button. An older API sends none, and the trail shows no narration rows.
   */
  | { event: "narration"; text: string }
  /**
   * The round's prose once the server knows it is WORKING, streamed as it arrives — for the
   * trail's live line only. Never folded into `live` or `answer`: the server withholds `delta`
   * for exactly this text so that self-talk cannot stand as the answer, and routing it back
   * into the answer path here would undo that. Absent from an older API, which simply leaves
   * the live line to `delta`'s first sentence.
   */
  | { event: "working"; text: string }
  | { event: "sources"; sources: AgentSource[] }
  /**
   * `unanswered` is set only when the text before `done` is the server's own closing ("I could
   * not put that answer into words…") rather than an answer. It is optional: an API that
   * predates it sends no such key, and the console then treats the closing as a completed turn,
   * which is what it did before the flag existed — the widening shape `detail` already follows.
   */
  | { event: "done"; stopReason: "complete" | "length" | "tool-limit"; unanswered?: true }
  | { event: "error"; message: string };

/**
 * Said only when the stream produced no text at all — `endOfStream` makes it impossible beneath
 * a partial answer.
 */
const NO_TEXT_NOTE = "The model did not answer. Try again shortly.";

/** Human wording for the endpoint's error codes. Never the raw envelope. */
function messageFor(code: string, fallback: string): string {
  switch (code) {
    case "budget_exhausted":
      // The server says when it is back (its allowance refills continuously); an older API's
      // sentence still reads fine, and a bodiless 503 gets the generic line.
      return fallback.startsWith("the agent")
        ? `${capitalise(fallback)}.`
        : "The agent is resting — its allowance is spent. Try again in a few minutes.";
    case "rate_limited":
      return "Too many questions at once. Give it a few seconds.";
    case "upstream_unavailable":
      return NO_TEXT_NOTE;
    default:
      return fallback;
  }
}

/** Why a stream stopped without a `done` event. */
export type StreamEndCause =
  /** The visitor pressed stop. Not a failure, and must not read as one. */
  | "stopped"
  /** An `error` event arrived, or the request never opened. */
  | "error"
  /** The body simply ended: a dropped connection, or the server returning mid-turn. */
  | "ended";

export interface StreamEnding {
  status: "truncated" | "failed";
  note: string;
}

/**
 * What to tell the reader when a turn ends without a `done` event.
 *
 * "The model did not answer" is honest only for a request that never produced a token; beneath a
 * partial answer every word of it would be false. `stopReason: "length"` cannot cover this,
 * because it comes from the provider's `finish_reason`, which only exists on a stream that
 * completed at the cap — this one ended with an `error` event or a dropped body and no `done`.
 *
 * The rule is the one the rest of the site follows for absence (`Unmeasured`, the Veil,
 * `unknowns`): name what you have and what you do not, and never describe a partial answer as no
 * answer. A stream that produced any text is reported as cut off.
 *
 * Pure and exported so it is pinned by a test rather than through the streaming path.
 */
export function endOfStream(
  text: string,
  cause: StreamEndCause,
  upstreamMessage: string | null,
): StreamEnding {
  // A stop the visitor asked for is not an error and gets no amber: they know why it ended, and
  // an apologetic note about our own reliability would be wrong about whose choice this was.
  if (cause === "stopped") return { status: "truncated", note: "You stopped this answer." };
  if (text.trim() !== "") {
    // The upstream's own message is deliberately discarded here. It describes the transport, and
    // the reader is looking at prose — so the note says what happened to the prose. "Ask again"
    // rather than "try again": there is no resume, and a follow-up question is the actual remedy.
    return { status: "truncated", note: "The answer was cut off before the end. Ask again." };
  }
  return { status: "failed", note: upstreamMessage ?? NO_TEXT_NOTE };
}

/**
 * A page of this site that tells Zeno where a question was asked, so he can answer as a guide to
 * that page. The server's `ASK_PAGES` is the authority and refuses any other value; a test holds the
 * two lists together.
 */
export type AgentPage = "learn";

export async function* askAgent(
  askUrl: string,
  messages: AgentTurn[],
  signal: AbortSignal,
  page?: AgentPage,
): AsyncGenerator<AgentStreamEvent> {
  let res: Response;
  try {
    res = await fetch(askUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // `page` is omitted rather than sent as null when the console asks from no particular page.
      body: JSON.stringify(page === undefined ? { messages } : { messages, page }),
      signal,
    });
  } catch {
    yield { event: "error", message: "Could not reach the agent. Check your connection." };
    return;
  }

  if (!res.ok || res.body === null) {
    let code = "";
    let detail = "";
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      code = body.error?.code ?? "";
      detail = body.error?.message ?? "";
    } catch {
      /* a rate-limited 429 from the proxy may carry no body at all */
    }
    yield {
      event: "error",
      message: messageFor(code, detail || `The agent answered ${res.status}.`),
    };
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      for (;;) {
        const boundary = buffer.indexOf("\n\n");
        if (boundary === -1) break;
        const raw = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const parsed = parseEvent(raw);
        if (parsed !== null) yield parsed;
      }
    }
  } catch {
    // An aborted read is the visitor navigating away; anything else is a dropped stream.
    if (!signal.aborted) {
      yield { event: "error", message: "The answer was cut off. Try again." };
    }
  } finally {
    reader.releaseLock();
  }
}

function parseEvent(raw: string): AgentStreamEvent | null {
  let name = "";
  let data = "";
  for (const line of raw.split("\n")) {
    if (line.startsWith("event: ")) name = line.slice("event: ".length).trim();
    else if (line.startsWith("data: ")) data += line.slice("data: ".length);
  }
  if (name === "" || data === "") return null;
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(data) as Record<string, unknown>;
  } catch {
    return null;
  }
  switch (name) {
    case "status":
      return {
        event: "status",
        state: payload.state === "looking-up" ? "looking-up" : "thinking",
        ...(typeof payload.tool === "string" ? { tool: payload.tool } : {}),
        // Type-checked rather than coerced: a non-string `detail` is a payload we do not
        // understand, and `String(…)` on one would render "[object Object]" into the trail as
        // though the agent had looked that up.
        ...(typeof payload.detail === "string" && payload.detail !== ""
          ? { detail: payload.detail }
          : {}),
      };
    case "delta":
      return typeof payload.text === "string" ? { event: "delta", text: payload.text } : null;
    case "reset":
      return { event: "reset" };
    case "narration":
      // Type-checked and dropped when empty, like `detail`: an empty narration row would render
      // as a blank line in the trail claiming the model said something.
      return typeof payload.text === "string" && payload.text !== ""
        ? { event: "narration", text: payload.text }
        : null;
    case "working":
      return typeof payload.text === "string" && payload.text !== ""
        ? { event: "working", text: payload.text }
        : null;
    case "sources":
      return { event: "sources", sources: (payload.sources as AgentSource[] | undefined) ?? [] };
    case "done":
      return {
        event: "done",
        stopReason: (payload.stopReason as "complete" | "length" | "tool-limit") ?? "complete",
        // Strictly `true`, never truthy: "unanswered": "no" is a payload we do not understand,
        // and reading it as a flag would make Zeno shrug at a real answer.
        ...(payload.unanswered === true ? { unanswered: true as const } : {}),
      };
    case "error": {
      const error = payload.error as { code?: string; message?: string } | undefined;
      return {
        event: "error",
        message: messageFor(error?.code ?? "", error?.message ?? "Something went wrong."),
      };
    }
    default:
      return null;
  }
}
