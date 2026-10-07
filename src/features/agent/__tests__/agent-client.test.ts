import { describe, expect, it } from "vitest";
import { askAgent, endOfStream, historyFor, type AgentStreamEvent } from "../agent-client";
import { parseAskBody } from "../../../../server/agent/guard";

/**
 * The note shown when a turn ends without a `done` event.
 *
 * "The model did not answer" is honest only when no tokens arrived; beneath partial prose it is
 * false. The property is stated as a property: no ending that carries text may claim nothing was
 * answered. A future ending cause is covered the moment it is added to the union.
 */

const ANSWER =
  "Transaction c860a7e8… has 13,538 transparent inputs and paid a fee of 0.0003 ZEC. Whether " +
  "that transparent output is a";

describe("endOfStream", () => {
  it("never says nothing was answered when text arrived", () => {
    for (const cause of ["error", "ended", "stopped"] as const) {
      for (const upstream of [null, "The model did not answer. Try again shortly."]) {
        const { note } = endOfStream(ANSWER, cause, upstream);
        expect(note, `${cause} claims silence`).not.toMatch(/did not answer|no answer/i);
      }
    }
  });

  it("calls a partial answer cut off, and does not dress it as our transport", () => {
    // The upstream message describes the connection; the reader is looking at prose, so the note
    // has to be about the prose.
    const ending = endOfStream(ANSWER, "error", "The model did not answer. Try again shortly.");
    expect(ending.status).toBe("truncated");
    expect(ending.note).toMatch(/cut off/i);
  });

  it("keeps the specific reason when there is no text to contradict it", () => {
    // Budget and rate-limit refusals never produce a token, so their wording is the useful one and
    // must survive: "the agent is resting" tells a visitor to come back tomorrow, and
    // "cut off before the end" would tell them to ask again immediately, forever.
    const resting = "The agent is resting — today's budget is spent. It wakes at midnight UTC.";
    expect(endOfStream("", "error", resting)).toEqual({ status: "failed", note: resting });
    expect(endOfStream("   \n ", "error", resting).note).toBe(resting);
  });

  it("falls back to the silence note only for a stream that produced nothing", () => {
    const ending = endOfStream("", "ended", null);
    expect(ending.status).toBe("failed");
    expect(ending.note).toMatch(/did not answer/i);
  });

  it("blames nobody when the visitor pressed stop", () => {
    // A stop is the visitor's choice, so the note must not read as a failure of ours — and it must
    // not be amber, which `status: "failed"` is what drives.
    for (const text of [ANSWER, ""]) {
      const ending = endOfStream(text, "stopped", "The model did not answer. Try again shortly.");
      expect(ending.status).toBe("truncated");
      expect(ending.note).toMatch(/you stopped/i);
    }
  });
});

/**
 * The SSE reader, driven through `askAgent` rather than through the parser directly.
 *
 * Framing is half of what these assertions are about — a `status` carrying a subject arrives as
 * `event:`/`data:` lines split on a blank line, and an event delivered across two network chunks
 * must parse identically to one delivered whole. Reaching in at `parseEvent` would test the
 * parsing and skip the splitting, which is where a streamed protocol actually breaks.
 */
function streamOf(chunks: readonly string[]): typeof globalThis.fetch {
  return (() =>
    Promise.resolve(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            const encoder = new TextEncoder();
            for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
            controller.close();
          },
        }),
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      ),
    )) as unknown as typeof globalThis.fetch;
}

async function read(chunks: readonly string[]): Promise<AgentStreamEvent[]> {
  const original = globalThis.fetch;
  globalThis.fetch = streamOf(chunks);
  try {
    const events: AgentStreamEvent[] = [];
    for await (const event of askAgent(
      "https://api.example/agent/ask",
      [{ role: "user", content: "what happened in block 3428150?" }],
      new AbortController().signal,
    )) {
      events.push(event);
    }
    return events;
  } finally {
    globalThis.fetch = original;
  }
}

const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

describe("reading a lookup's subject off the stream", () => {
  it("carries the subject through to the trail", async () => {
    const events = await read([
      sse("status", { state: "looking-up", tool: "lookup_block", detail: "3428150" }),
    ]);
    expect(events).toEqual([
      { event: "status", state: "looking-up", tool: "lookup_block", detail: "3428150" },
    ]);
  });

  it("tolerates an API that predates the subject, losing the detail and never the row", async () => {
    // The older-deployment path, and the reason `detail` is optional: the agent container is
    // deployed separately and can lag the frontend, so this is the ordinary case.
    const events = await read([sse("status", { state: "looking-up", tool: "lookup_block" })]);
    expect(events).toEqual([{ event: "status", state: "looking-up", tool: "lookup_block" }]);
  });

  it("drops a subject that is not a string rather than rendering it", async () => {
    // `String({})` is "[object Object]", which would appear in the trail as a thing the agent
    // looked up. Absent is the honest rendering of a payload we do not understand.
    for (const detail of [{ a: 1 }, 7, null, ""]) {
      const events = await read([
        sse("status", { state: "looking-up", tool: "lookup_block", detail }),
      ]);
      expect(events[0]).toEqual({ event: "status", state: "looking-up", tool: "lookup_block" });
    }
  });

  it("carries `working` text through as its own event, and drops an empty one", async () => {
    const events = await read([
      sse("working", { text: "Let me check " }),
      sse("working", { text: "" }),
      sse("working", { text: "that block." }),
    ]);
    expect(events).toEqual([
      { event: "working", text: "Let me check " },
      { event: "working", text: "that block." },
    ]);
  });

  it("parses an event split across network chunks exactly as a whole one", async () => {
    const whole = sse("status", {
      state: "looking-up",
      tool: "crosschain",
      detail: "BTC · to 2026-08-01",
    });
    const split = await read([whole.slice(0, 20), whole.slice(20, 45), whole.slice(45)]);
    expect(split).toEqual(await read([whole]));
    expect(split[0]).toMatchObject({ detail: "BTC · to 2026-08-01" });
  });
});

describe("reading narration off the stream", () => {
  it("carries the model's working through to the trail", async () => {
    const events = await read([sse("narration", { text: "Fetching the monthly window." })]);
    expect(events).toEqual([{ event: "narration", text: "Fetching the monthly window." }]);
  });

  it("drops narration that is empty or not a string, never rendering a blank row", async () => {
    for (const text of ["", 7, null, { a: 1 }]) {
      expect(await read([sse("narration", { text })])).toEqual([]);
    }
  });

  it("reads the server's unanswered flag, and only a literal true", async () => {
    // The flag is what stops Zeno celebrating the server's own "I could not put that answer into
    // words" closing. A truthy non-boolean is a payload we do not understand, and reading it as
    // the flag would make Zeno shrug at a real answer.
    expect(await read([sse("done", { stopReason: "complete", unanswered: true })])).toEqual([
      { event: "done", stopReason: "complete", unanswered: true },
    ]);
    for (const unanswered of ["yes", 1, false, null]) {
      expect(await read([sse("done", { stopReason: "complete", unanswered })])).toEqual([
        { event: "done", stopReason: "complete" },
      ]);
    }
  });

  it("treats a done from an API that predates the flag as an ordinary ending", async () => {
    expect(await read([sse("done", { stopReason: "complete" })])).toEqual([
      { event: "done", stopReason: "complete" },
    ]);
  });

  it("still drops an event name it does not know", async () => {
    // The widening-safety property in the other direction: an older frontend against a newer
    // API drops the unknown event, so this parser must keep doing that for the next one.
    expect(await read([sse("chit-chat", { text: "hello" })])).toEqual([]);
  });
});

/**
 * The history a follow-up carries. A stopped exchange with an empty answer must not be replayed
 * as an empty assistant turn: the server gate rejects that, and since the exchange stays on
 * screen every later question would fail until reload.
 */
describe("historyFor", () => {
  const answered = (question: string, answer: string) => ({ question, answer });

  it("drops an exchange that produced no answer, and its question with it", () => {
    // Ask, stop before the first token, ask again.
    const history = historyFor([answered("test", "")], "test");
    expect(history).toEqual([{ role: "user", content: "test" }]);
    // The property that actually broke: nothing empty may reach the gate.
    for (const turn of history) expect(turn.content.trim()).not.toBe("");
  });

  it("agrees with the server gate about every history it can build", () => {
    // The gate is the authority on what is sendable, so it is asked rather than paraphrased —
    // this is the one place the client and the gate must not drift.
    const past = [
      answered("first", "an answer"),
      answered("stopped at once", ""),
      answered("whitespace only", "   \n  "),
      answered("partly written", "a cut-off answer"),
    ];
    const result = parseAskBody({ messages: historyFor(past, "next") });
    expect(result.ok, result.ok ? "" : result.error).toBe(true);
  });

  it("keeps a stopped answer that DID write prose — it is real context", () => {
    const history = historyFor([answered("what is Ironwood?", "It is the fourth")], "go on");
    expect(history).toEqual([
      { role: "user", content: "what is Ironwood?" },
      { role: "assistant", content: "It is the fourth" },
      { role: "user", content: "go on" },
    ]);
  });

  it("never begins on an assistant turn when the conversation is capped", () => {
    // An assistant turn stranded without the question it answered would read as the agent
    // having volunteered it. The cap is odd for exactly this reason.
    const past = Array.from({ length: 20 }, (_, i) => answered(`q${i}`, `a${i}`));
    const history = historyFor(past, "latest");
    expect(history).toHaveLength(7);
    expect(history[0]!.role).toBe("user");
    expect(history[history.length - 1]).toEqual({ role: "user", content: "latest" });
  });

  it("sends the question alone when nothing has been answered yet", () => {
    expect(historyFor([], "first question")).toEqual([{ role: "user", content: "first question" }]);
  });
});

describe("the request a question is sent as", () => {
  async function bodyOf(page?: "learn"): Promise<unknown> {
    const original = globalThis.fetch;
    let sent: unknown = null;
    globalThis.fetch = ((_url: string, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return streamOf([])(_url, init);
    }) as typeof globalThis.fetch;
    try {
      const turn = askAgent(
        "https://api.example/agent/ask",
        [{ role: "user", content: "what does shielding do?" }],
        new AbortController().signal,
        page,
      );
      for await (const event of turn) void event;
    } finally {
      globalThis.fetch = original;
    }
    return sent;
  }

  it("is unchanged for the console, which names no page", async () => {
    // Byte-identical to before the field existed: an agent one deploy behind still answers it.
    expect(await bodyOf()).toEqual({
      messages: [{ role: "user", content: "what does shielding do?" }],
    });
  });

  it("names the page it was asked from, a value the server accepts", async () => {
    const body = (await bodyOf("learn")) as { page: string };
    expect(body).toEqual({
      messages: [{ role: "user", content: "what does shielding do?" }],
      page: "learn",
    });
    expect(parseAskBody(body).ok).toBe(true);
  });
});
