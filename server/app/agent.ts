import type { Hono } from "hono";
import { hasDotSegment } from "@/lib/path-segments";
import { AgentBudget } from "../agent/budget";
import { agentRoutes } from "../agent/index";
import { resolveProvider } from "../agent/provider";
import type { ChainRequester } from "../agent/tools";
import type { BearerAuth } from "../auth";
import { PostgresFxRates } from "../fx-rates";
import { createPool } from "../pg-pool";
import { DATABASE_URL, USE_POSTGRES } from "./config";

/** The answer to an in-process request whose path contains a `.` or `..` segment. */
function dotSegmentRefusal(): Response {
  return new Response(JSON.stringify({ error: { code: "bad_request", message: "invalid path" } }), {
    status: 400,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Mount the `/agent` surface: keyless like `/v1`, behind its own flag. It refuses to mount without
 * its two hard dependencies rather than degrading: an agent with no model key cannot answer, and
 * one with no budget meter must not (an unmetered LLM endpoint is an open tap).
 */
export function mountAgent(
  app: Hono,
  deps: { v1App: Hono; auth: BearerAuth; log: (message: string) => void },
): void {
  const { v1App, auth, log } = deps;
  // Which inference host, and therefore which key (`AGENT_INFERENCE_PROVIDER`). The resolver throws
  // on an unrecognised value rather than falling back, so a typo fails at boot instead of sending
  // one vendor's key to the other.
  const inferenceProvider = resolveProvider();
  const inferenceKey = process.env[inferenceProvider.keyEnv];
  if (!inferenceKey) {
    log(`AGENT_ENABLED set but ${inferenceProvider.keyEnv} missing — /agent not mounted`);
    return;
  }
  if (!USE_POSTGRES) {
    log("AGENT_ENABLED set but no Postgres for the budget meter — /agent not mounted");
    return;
  }
  /*
   * A small conservative default: a real deployment sets this explicitly. At the measured cost of
   * tens of thousands of tokens per request, the default funds only a handful of questions. The
   * production figures are pinned by `budget.test.ts` against `server/Caddyfile`.
   */
  const dailyTokenBudget = Number(process.env.AGENT_DAILY_TOKEN_BUDGET ?? 500_000);
  // "Infinity" would mean an unlimited paid endpoint; refuse to start rather than guess.
  if (!Number.isFinite(dailyTokenBudget) || dailyTokenBudget <= 0) {
    throw new Error("AGENT_DAILY_TOKEN_BUDGET must be a positive, finite number of tokens");
  }
  const budgetPool = createPool(DATABASE_URL, { max: 2, statement_timeout: 5_000 });
  const budget = new AgentBudget(budgetPool, dailyTokenBudget);
  void budget.ensureSchema().catch((err) => log(`agent_budget schema: ${String(err)}`));
  /*
   * USD→currency rates, so a reader can ask what something is worth in another currency. Its own
   * tiny pool. Cold until the first refresh succeeds, and cold means `offered()` holds usd alone,
   * so a currency asked for during start-up is refused by name rather than answered at a rate of
   * one.
   */
  const fxPool = createPool(DATABASE_URL, { max: 2, statement_timeout: 5_000 });
  const fxRates = new PostgresFxRates(fxPool, log);
  fxRates.start();
  /**
   * The private API, dispatched in-process for the agent's aggregate-analytics tools.
   *
   * `app` is the whole service, so this carries the bearer header the gate compares against, from
   * the same `BearerAuth`, so the agent's dispatch cannot drift from the gate it has to pass. The
   * token stays here and never reaches `AgentTools` or the model: the tool holds a port with one
   * method taking a path.
   *
   * Dispatching at the app rather than calling query functions directly means a renamed route
   * breaks the agent's tests in the same commit instead of the agent silently answering 404.
   */
  const chainRequester: ChainRequester = {
    request: (path) =>
      hasDotSegment(path)
        ? dotSegmentRefusal()
        : app.request(path, { headers: { authorization: auth.header() } }),
  };
  const v1Requester = {
    request: (path: string) => (hasDotSegment(path) ? dotSegmentRefusal() : v1App.request(path)),
  };
  app.route(
    "/",
    agentRoutes({
      v1: v1Requester,
      chain: chainRequester,
      budget,
      fx: fxRates,
      apiKey: inferenceKey,
      provider: inferenceProvider,
    }),
  );
  log(
    `AGENT mounted — ${inferenceProvider.model} @ ${inferenceProvider.id}, daily budget ${dailyTokenBudget} tokens, keyless, Caddy-limited`,
  );
}
