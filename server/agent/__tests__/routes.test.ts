import { TURN_RESERVE_TOKENS } from "../budget";
import { describe, expect, it } from "vitest";
import type { CompletionParams, StreamEvent } from "../chat-client";
import { agentRoutes, describeWait, MAX_ASK_BODY_BYTES, type BudgetPort } from "../index";
import { AdmissionGate } from "../../admission-gate";
import { makeChain, makeV1 } from "../testing/fixture-world";

/**
 * The HTTP boundary of /agent/ask, tested like v1-routes.test.ts tests /v1: via app.request, with
 * no server and no network. The streamer is scripted; everything else (guard, loop, tools against
 * the real /v1 routing, SSE serialisation) is real.
 */

function scripted(turns: StreamEvent[][]) {
  const calls: CompletionParams[] = [];
  async function* streamer(params: CompletionParams): AsyncGenerator<StreamEvent> {
    calls.push(params);
    const turn = turns.shift();
    if (turn === undefined) throw new Error("script exhausted");
    for (const e of turn) yield e;
  }
  return { streamer, calls };
}

const answer = (text: string): StreamEvent[] => [
  { type: "content", text },
  {
    type: "done",
    finishReason: "stop",
    toolCalls: [],
    usage: { promptTokens: 900, completionTokens: 40 },
  },
];

function okBudget(): BudgetPort & { recorded: { tokensIn: number; tokensOut: number }[] } {
  const recorded: { tokensIn: number; tokensOut: number }[] = [];
  return {
    recorded,
    check: async () => ({ allowed: true, tokensUsed: 0 }),
    record: async (_now, tokensIn, tokensOut) => {
      recorded.push({ tokensIn, tokensOut });
    },
  };
}

function app(
  turns: StreamEvent[][] = [answer("Ironwood is the fourth shielded pool.")],
  budget: BudgetPort = okBudget(),
) {
  const { streamer, calls } = scripted(turns);
  return { app: agentRoutes({ v1: makeV1(), chain: makeChain(), budget, streamer }), calls };
}

const ask = (body: unknown) =>
  new Request("http://localhost/agent/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("POST /agent/ask", () => {
  it("streams SSE: status, sanitised deltas, sources, done", async () => {
    const res = await app().app.request(ask({ messages: [{ role: "user", content: "hi" }] }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    const body = await res.text();
    expect(body).toContain("event: status");
    // Deltas may split at any construct-safe boundary; the answer is their concatenation.
    const answerText = [...body.matchAll(/event: delta\ndata: (.+)/g)]
      .map(([, json]) => (JSON.parse(json!) as { text: string }).text)
      .join("");
    expect(answerText).toBe("Ironwood is the fourth shielded pool.");
    expect(body).toContain("event: sources");
    expect(body).toContain('"stopReason":"complete"');
  });

  it("rejects an invalid body with the /v1 error envelope, before any model call", async () => {
    const { app: a, calls } = app();
    const res = await a.request(ask({ messages: [], sessionId: "x" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string }; requestId: string; asOf: number };
    expect(body.error.code).toBe("invalid_request");
    expect(typeof body.requestId).toBe("string");
    expect(calls).toHaveLength(0);
  });

  it("rejects a non-JSON body as invalid_request, not a crash", async () => {
    const res = await app().app.request(
      new Request("http://localhost/agent/ask", { method: "POST", body: "not json" }),
    );
    expect(res.status).toBe(400);
  });

  it("answers 503 budget_exhausted when the day's meter is full — and never calls the model", async () => {
    const spent: BudgetPort = {
      check: async () => ({ allowed: false, tokensUsed: 5_000_000, retryAfterSeconds: 720 }),
      record: async () => {},
    };
    const { app: a, calls } = app([answer("never")], spent);
    const res = await a.request(ask({ messages: [{ role: "user", content: "hi" }] }));
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("budget_exhausted");
    expect(body.error.message).toMatch(/resting/);
    // The allowance refills continuously, so the refusal says when — in the header a client can act
    // on and in the sentence a reader sees. Never "midnight UTC".
    expect(res.headers.get("Retry-After")).toBe("720");
    expect(body.error.message).toMatch(/back in about 12 minutes/);
    expect(body.error.message).not.toMatch(/midnight/);
    expect(calls).toHaveLength(0);
  });

  it("describes a wait coarsely, as the estimate it is", () => {
    expect(describeWait(4)).toBe("10 seconds");
    expect(describeWait(47)).toBe("50 seconds");
    expect(describeWait(720)).toBe("12 minutes");
    expect(describeWait(3_000)).toBe("50 minutes");
    expect(describeWait(7_200)).toBe("2 hours");
  });

  it("fails closed when the budget meter is unreachable", async () => {
    const broken: BudgetPort = {
      check: async () => {
        throw new Error("connection refused");
      },
      record: async () => {},
    };
    const { app: a } = app([answer("never")], broken);
    const res = await a.request(ask({ messages: [{ role: "user", content: "hi" }] }));
    expect(res.status).toBe(503);
  });

  it("records the turn's usage against the meter", async () => {
    const budget = okBudget();
    const { app: a } = app([answer("hello")], budget);
    await (await a.request(ask({ messages: [{ role: "user", content: "hi" }] }))).text();
    expect(budget.recorded).toEqual([{ tokensIn: 900, tokensOut: 40 }]);
  });

  it("charges at least a turn's reserve when the turn is cut off before usage arrives", async () => {
    async function* cutOff(): AsyncGenerator<StreamEvent> {
      yield { type: "content", text: "partial" };
      throw new Error("visitor disconnected");
    }
    const budget = okBudget();
    const a = agentRoutes({ v1: makeV1(), chain: makeChain(), budget, streamer: () => cutOff() });
    await (await a.request(ask({ messages: [{ role: "user", content: "hi" }] }))).text();
    const total = budget.recorded.reduce((n, r) => n + r.tokensIn + r.tokensOut, 0);
    expect(total).toBeGreaterThanOrEqual(TURN_RESERVE_TOKENS);
  });

  it("charges the reserve when a finished turn reported no usage at all", async () => {
    const budget = okBudget();
    const noUsage: StreamEvent[] = [
      { type: "content", text: "hello" },
      { type: "done", finishReason: "stop", toolCalls: [], usage: null },
    ];
    const { app: a } = app([noUsage], budget);
    await (await a.request(ask({ messages: [{ role: "user", content: "hi" }] }))).text();
    const total = budget.recorded.reduce((n, r) => n + r.tokensIn + r.tokensOut, 0);
    expect(total).toBeGreaterThanOrEqual(TURN_RESERVE_TOKENS);
  });

  it("a model failure mid-stream becomes an SSE error event, not a broken pipe", async () => {
    async function* failing(): AsyncGenerator<StreamEvent> {
      yield { type: "content", text: "partial" };
      throw new Error("provider fell over");
    }
    const a = agentRoutes({
      v1: makeV1(),
      chain: makeChain(),
      budget: okBudget(),
      streamer: () => failing(),
    });
    const res = await a.request(ask({ messages: [{ role: "user", content: "hi" }] }));
    const body = await res.text();
    expect(body).toContain("event: error");
    expect(body).toContain("upstream_unavailable");
    // The provider's own words never reach the visitor.
    expect(body).not.toContain("fell over");
  });

  it("GET on /agent/ask is not a route", async () => {
    const res = await app().app.request("http://localhost/agent/ask");
    expect([404, 405]).toContain(res.status);
  });

  /**
   * The origins the page is actually served from. The `.netlify.app` forms matter: branch deploys
   * are `<branch>--shieldedscan.netlify.app` and PR previews are
   * `deploy-preview-<n>--shieldedscan.netlify.app`, and omitting them would block the preflight
   * from exactly the deployments the agent is tested on.
   */
  it.each([
    "https://shieldedscan.xyz",
    "https://www.shieldedscan.xyz",
    "https://testnet.shieldedscan.xyz",
    "https://shieldedscan.netlify.app",
    "https://worktree-ai-agent--shieldedscan.netlify.app",
    "https://deploy-preview-42--shieldedscan.netlify.app",
    "http://localhost:3000",
  ])("allows the browser origin %s", async (origin) => {
    const res = await app().app.request(
      new Request("http://localhost/agent/ask", {
        method: "OPTIONS",
        headers: {
          Origin: origin,
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type",
        },
      }),
    );
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(origin);
  });

  it.each([
    "https://evil.example",
    // Suffix spoofing: a host that merely ends with our name is not ours.
    "https://notshieldedscan.xyz",
    "https://shieldedscan.xyz.evil.example",
    "https://shieldedscan.netlify.app.evil.example",
    // Someone else's Netlify site must not be able to spend our budget from a browser.
    "https://someone-else.netlify.app",
  ])("refuses the foreign origin %s", async (origin) => {
    const res = await app().app.request(
      new Request("http://localhost/agent/ask", {
        method: "OPTIONS",
        headers: {
          Origin: origin,
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type",
        },
      }),
    );
    expect(res.headers.get("Access-Control-Allow-Origin")).not.toBe(origin);
  });

  it("answers CORS preflight so the browser can call cross-origin", async () => {
    const res = await app().app.request(
      new Request("http://localhost/agent/ask", {
        method: "OPTIONS",
        headers: {
          Origin: "https://shieldedscan.xyz",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type",
        },
      }),
    );
    expect(res.status).toBeLessThan(300);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeTruthy();
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
  });

  it("GET /agent/health answers without touching budget or model", async () => {
    const res = await app().app.request("http://localhost/agent/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

// ------------------------------------------------------------- request size and admission limits

describe("request body ceiling", () => {
  it("refuses an oversized body at the wire, with the error envelope, before parsing it", async () => {
    // The gate caps messages in characters after `c.req.json()` has buffered the whole body; this
    // is the byte ceiling in front of that. The JSON is well-formed, so only the size refuses it.
    const filler = "x".repeat(MAX_ASK_BODY_BYTES + 1024);
    const res = await app().app.request(ask({ messages: [{ role: "user", content: filler }] }));
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("invalid_request");
  });

  it("still accepts a body just under the ceiling", async () => {
    // Under the byte ceiling and over the character cap: the character gate must answer, which
    // proves the byte limit did not swallow a request it should have passed on.
    const filler = "x".repeat(2_000);
    const res = await app().app.request(ask({ messages: [{ role: "user", content: filler }] }));
    expect(res.status).toBe(400);
  });
});

describe("AdmissionGate", () => {
  it("admits up to the slot count immediately", async () => {
    const gate = new AdmissionGate(2, 2, 1_000);
    expect(await gate.acquire()).toBe("admitted");
    expect(await gate.acquire()).toBe("admitted");
    expect(gate.inFlight).toBe(2);
  });

  it("hands a freed slot to the longest-waiting caller, in order", async () => {
    const gate = new AdmissionGate(1, 4, 1_000);
    await gate.acquire();
    const order: string[] = [];
    const a = gate.acquire().then((r) => order.push(`a:${r}`));
    const b = gate.acquire().then((r) => order.push(`b:${r}`));
    expect(gate.waiting).toBe(2);
    gate.release();
    await a;
    expect(order).toEqual(["a:admitted"]);
    expect(gate.inFlight).toBe(1);
    gate.release();
    await b;
    expect(order).toEqual(["a:admitted", "b:admitted"]);
  });

  it("refuses on the spot once the waiting room is full", async () => {
    const gate = new AdmissionGate(1, 1, 1_000);
    await gate.acquire();
    const waiting = gate.acquire();
    expect(await gate.acquire()).toBe("full");
    gate.release();
    expect(await waiting).toBe("admitted");
  });

  it("times out a waiter and leaves the counts consistent", async () => {
    const gate = new AdmissionGate(1, 4, 20);
    await gate.acquire();
    expect(await gate.acquire()).toBe("timeout");
    expect(gate.waiting).toBe(0);
    expect(gate.inFlight).toBe(1);
    // A later release with nobody waiting must not go negative or wake a ghost.
    gate.release();
    expect(gate.inFlight).toBe(0);
    expect(await gate.acquire()).toBe("admitted");
  });

  it("drops a waiter whose caller went away, without taking a slot for it", async () => {
    const gate = new AdmissionGate(1, 4, 1_000);
    await gate.acquire();
    const ctl = new AbortController();
    const waiting = gate.acquire(ctl.signal);
    ctl.abort();
    expect(await waiting).toBe("timeout");
    expect(gate.waiting).toBe(0);
    gate.release();
    expect(gate.inFlight).toBe(0);
  });

  it("the route answers 503 with Retry-After when neither a slot nor a place to wait is free", async () => {
    // A streamer that never ends holds its slot; the gate's bounds turn the ninth caller's wait
    // into a refusal rather than a hang. Exercised through a gate-sized script: eight hung turns,
    // sixteen waiters, then one refusal.
    const hung: StreamEvent[][] = [];
    async function* neverEnds(): AsyncGenerator<StreamEvent> {
      yield { type: "content", text: "…" };
      await new Promise<void>(() => {});
    }
    void hung;
    const routes = agentRoutes({
      v1: makeV1(),
      chain: makeChain(),
      budget: okBudget(),
      streamer: neverEnds,
    });
    const body = { messages: [{ role: "user", content: "hi" }] };
    const pending = Array.from({ length: 8 + 16 }, () => routes.request(ask(body)));
    // Every slot and every waiting place is now taken; the next caller is told to come back.
    const refused = await routes.request(ask(body));
    expect(refused.status).toBe(503);
    expect(refused.headers.get("Retry-After")).toBe("5");
    const envelope = (await refused.json()) as { error: { code: string } };
    expect(envelope.error.code).toBe("rate_limited");
    void pending;
  });
});
