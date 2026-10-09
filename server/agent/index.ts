import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { requestId } from "hono/request-id";
import { streamSSE } from "hono/streaming";
import { parseAskBody } from "./guard";
import { runAgentTurn } from "./loop";
import { streamerFor, type ChatStreamer } from "./chat-client";
import { resolveProvider, type InferenceProvider } from "./provider";
import type { FxPort } from "../fx-rates";
import { AgentTools, type ChainRequester, type V1Requester } from "./tools";
import { AdmissionGate } from "../admission-gate";
import { TURN_RESERVE_TOKENS } from "./budget";
import { DAY_SECONDS } from "@/domain/time";

/**
 * The /agent HTTP surface: POST /agent/ask (SSE) and GET /agent/health.
 *
 * Mounted behind AGENT_ENABLED and deliberately not under /v1: that prefix is a documented data
 * contract, and an agent is non-deterministic, expensive per call and not something to build
 * software against. Caddy adds its own /agent/* rate-limit zones in front of this.
 *
 * Nothing here logs, stores or identifies: the error envelope's requestId is the only debugging
 * handle, budget rows count tokens per day and never per client, and history lives in the
 * visitor's browser tab.
 */

/**
 * The agent's error codes, in /v1's envelope shape but its own vocabulary: /agent is a separate
 * contract, and agent-only codes do not belong in the data API's descriptor.
 */
type AgentErrorCode =
  "invalid_request" | "budget_exhausted" | "rate_limited" | "upstream_unavailable";

/** "40 seconds", "12 minutes", "2 hours" — coarse on purpose; it is an estimate of a refill. */
export function describeWait(seconds: number): string {
  if (seconds < 90) return `${Math.max(10, Math.round(seconds / 10) * 10)} seconds`;
  if (seconds < 5_400) return `${Math.max(2, Math.round(seconds / 60))} minutes`;
  return `${Math.max(2, Math.round(seconds / 3_600))} hours`;
}

function agentError(c: Context, code: AgentErrorCode, message: string) {
  return {
    error: { code, message },
    // The only debugging handle a no-logs service can offer: the caller quotes it and can
    // correlate their own records.
    requestId: (c.get("requestId") as string | undefined) ?? "unknown",
    asOf: Math.floor(Date.now() / 1000),
  };
}

/**
 * Origins the site is genuinely served from: the custom domain and its subdomains, the
 * Netlify name and its `--` preview forms, and localhost for development.
 */
const SITE_ORIGIN_PATTERNS: readonly RegExp[] = [
  /^https:\/\/([a-z0-9-]+\.)?shieldedscan\.xyz$/,
  /^https:\/\/([a-z0-9-]+--)?shieldedscan\.netlify\.app$/,
  /^http:\/\/localhost(:\d+)?$/,
];

function isSiteOrigin(origin: string): boolean {
  return SITE_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin));
}

/** What the route needs of the budget — structural, so tests inject their own. */
export interface BudgetPort {
  check(
    nowMs: number,
  ): Promise<{ allowed: boolean; tokensUsed: number; retryAfterSeconds?: number }>;
  record(nowMs: number, tokensIn: number, tokensOut: number): Promise<void>;
}

export interface AgentRouteDeps {
  /** The /v1 sub-app the entity-detail tools dispatch through in-process. */
  v1: V1Requester;
  /**
   * The private API the aggregate-analytics tool dispatches through in-process, bearer header
   * already attached. Required: an agent that advertises `explorer_insights` in every prompt and
   * 404s when the model uses it would be worse than one without the tool.
   */
  chain: ChainRequester;
  budget: BudgetPort;
  /**
   * USD→currency rates, so a reader can ask for a figure in something other than dollars.
   *
   * Optional, unlike `chain`: absent means a USD-only port that refuses every other currency by
   * name rather than answering in dollars, so a deployment without `fx_rate_daily` still runs.
   */
  fx?: FxPort;
  /** Overridable for tests and the eval runner; production passes streamChat. */
  streamer?: ChatStreamer;
  apiKey?: string;
  /**
   * Which inference host to talk to. Defaults to what the environment resolves to
   * (`resolveProvider`); a swap is opt-in and the eval corpus is the gate.
   */
  provider?: InferenceProvider;
  now?: () => number;
}

/**
 * Wall clock for one turn: a stream that outlives this is holding a slot hostage.
 *
 * A wall clock cannot tell a slow good answer from a hung one; only silence can, and that is the
 * job of `MODEL_IDLE_MS` and `STALL_RETRY_MS` in `loop.ts`. This is the backstop behind both, for
 * failures they cannot see (e.g. a tool call that never returns), so it must sit well above the
 * distribution of healthy turns, never inside it: a long multi-lookup answer streaming a table
 * must not be cut off. `loop.test.ts` pins that relationship. Raise it whenever a healthy turn is
 * observed near it.
 *
 * It does not bound cost or capacity: `MAX_OUTPUT_TOKENS`, the tool-call cap and the daily budget
 * bound spend; `MAX_IN_FLIGHT` bounds the process. An actively streaming answer costs its tokens
 * whether or not it is aborted, and the visitor always has `stop`.
 */
export const TURN_TIMEOUT_MS = 600_000;
/** Concurrent turns per process; beyond it a caller WAITS briefly, then is told "busy". */
export const MAX_IN_FLIGHT = 8;
/**
 * How many callers may wait for a slot, and for how long, before the answer is a 503.
 *
 * A turn is mostly network waiting, so a burst of simultaneous questions would otherwise refuse a
 * caller while a slot is seconds from freeing. The bounds keep the wait from becoming a queue that
 * hides an outage: at most 16 waiters (2× the slots), at most 10 s (inside a visitor's patience
 * and Caddy's proxy timeout), and the 503 still carries `Retry-After`. Nothing about who waited
 * is kept.
 */
const MAX_WAITING = 16;
const MAX_WAIT_MS = 10_000;

/**
 * The request body ceiling for POST /agent/ask, enforced before the body is buffered.
 *
 * `parseAskBody` caps every message in characters, but only after `c.req.json()` has read the
 * whole body into memory. The largest legitimate body is 8 messages at the larger character cap in
 * 4-byte UTF-8 (the gate does not force alternation), which `loop.test.ts` pins under this;
 * anything larger is refused at the wire with the same error envelope.
 */
export const MAX_ASK_BODY_BYTES = 1024 * 1024;

export function agentRoutes(deps: AgentRouteDeps): Hono {
  const app = new Hono();
  const now = deps.now ?? Date.now;
  const provider = deps.provider ?? resolveProvider();
  const streamer: ChatStreamer = deps.streamer ?? streamerFor(provider, deps.apiKey ?? "");
  // One clock for the whole turn, so the window a price lookup resolves and the date the prompt
  // states come from the same reading.
  const tools = new AgentTools(deps.v1, deps.chain, now, deps.fx);
  const gate = new AdmissionGate(MAX_IN_FLIGHT, MAX_WAITING, MAX_WAIT_MS);

  app.use("/agent/*", requestId());
  app.use(
    "/agent/ask",
    bodyLimit({
      maxSize: MAX_ASK_BODY_BYTES,
      onError: (c) =>
        c.json(agentError(c, "invalid_request", `body exceeds ${MAX_ASK_BODY_BYTES} bytes`), 413),
    }),
  );
  app.use(
    "/agent/*",
    cors({
      // The page fetches cross-origin from the site to this host. Browsers enforce this; curl does
      // not, so the budget is the real control. What the scoping buys is that a stranger cannot embed
      // this agent in their own page and spend our budget from their visitors' browsers.
      //
      // The `.netlify.app` forms are required: branch deploys (`<branch>--shieldedscan.netlify.app`)
      // and PR previews (`deploy-preview-<n>--shieldedscan.netlify.app`) must work, and a failed
      // preflight surfaces as a page that silently does nothing.
      //
      // Anchored at both ends, so `shieldedscan.xyz.evil.example` and `someone-else.netlify.app` are
      // both refused.
      origin: (origin) => (isSiteOrigin(origin) ? origin : undefined),
      allowMethods: ["POST", "OPTIONS"],
      allowHeaders: ["Content-Type"],
      maxAge: DAY_SECONDS,
      credentials: false,
    }),
  );

  app.get("/agent/health", (c) => c.json({ ok: true }));

  app.post("/agent/ask", async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json(agentError(c, "invalid_request", "body must be JSON"), 400);
    }
    const parsed = parseAskBody(raw);
    if (!parsed.ok) {
      return c.json(agentError(c, "invalid_request", parsed.error), 400);
    }

    // Fail closed: an unreadable meter must not allow traffic (budget.ts). 503, never a silent
    // allow.
    let allowed: boolean;
    let retryAfterSeconds: number | undefined;
    try {
      ({ allowed, retryAfterSeconds } = await deps.budget.check(now()));
    } catch {
      return c.json(
        agentError(
          c,
          "budget_exhausted",
          "the agent cannot verify its budget right now — try again shortly",
        ),
        503,
      );
    }
    if (!allowed) {
      // The bucket refills continuously, so the refusal names WHEN rather than "midnight UTC":
      // a reader who knows the wait is minutes does not conclude the site is broken.
      const wait = retryAfterSeconds ?? 60;
      c.header("Retry-After", String(wait));
      return c.json(
        agentError(
          c,
          "budget_exhausted",
          `the agent is resting — its allowance is spent; it is back in about ${describeWait(wait)}`,
        ),
        503,
      );
    }

    // Wait briefly for a slot rather than refusing on the spot; the wait is bounded in both
    // depth and time, and the refusal that follows still says when to come back.
    const admission = await gate.acquire(c.req.raw.signal);
    if (admission !== "admitted") {
      c.header("Retry-After", admission === "full" ? "5" : "10");
      return c.json(
        agentError(c, "rate_limited", "the agent is at capacity — try again in a few seconds"),
        503,
      );
    }

    // One turn's ceiling: the visitor closing the tab aborts the provider fetch (a cost control),
    // and the timeout bounds a hung provider. The clock starts after admission, so time spent
    // waiting for a slot is not charged to the turn.
    const signal = AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(TURN_TIMEOUT_MS)]);
    let tokensIn = 0;
    let tokensOut = 0;
    let completed = false;

    return streamSSE(
      c,
      async (stream) => {
        try {
          const turn = runAgentTurn(
            {
              streamer,
              tools,
              now,
              // The active host's model, not the prompt module's constant: they disagree whenever the
              // provider is overridden, and a model id sent to a host that does not serve it 404s.
              model: provider.model,
              onUsage: (usage) => {
                tokensIn += usage.promptTokens;
                tokensOut += usage.completionTokens;
              },
            },
            parsed.messages,
            signal,
            parsed.page,
          );
          for await (const event of turn) {
            await stream.writeSSE({ event: event.event, data: JSON.stringify(event.data) });
          }
          completed = !signal.aborted;
        } catch {
          // The provider's own words never reach the visitor: a transport error carries whatever the
          // upstream wrote. The requestId in the envelope is the caller's only correlation handle.
          await stream.writeSSE({
            event: "error",
            data: JSON.stringify(
              agentError(
                c,
                "upstream_unavailable",
                "the model provider did not answer — try again shortly",
              ),
            ),
          });
        } finally {
          gate.release();
          // A turn cut off before the provider reported usage (the visitor disconnected, the
          // provider failed) has still been billed for the prompt it sent, and a provider that
          // stops sending a usage block would otherwise make every turn free. Either way the turn
          // is charged at least the per-turn reserve, so the budget cannot be bypassed.
          const charged = completed && tokensIn + tokensOut > 0;
          const promptCharge = charged
            ? tokensIn
            : Math.max(tokensIn, TURN_RESERVE_TOKENS - tokensOut);
          await deps.budget.record(now(), promptCharge, tokensOut).catch(() => {
            console.error("agent budget: meter write failed");
          });
        }
      },
      async (_err, stream) => {
        // streamSSE's own error hook; the try/catch above already answered the visitor.
        await stream.close();
      },
    );
  });

  return app;
}
