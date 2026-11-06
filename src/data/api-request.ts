import { hasDotSegment } from "@/lib/path-segments";
import { isTransientUpstream } from "@/lib/transient-upstream";
import { apiBreaker } from "@/lib/upstream-breaker";

/**
 * The one HTTP request both API adapters make: bearer-authenticated, retried,
 * breaker-guarded. Both talk to the same API, so they share one retry policy.
 */
export interface ApiRequestConfig {
  baseUrl: string;
  token: string;
}

/**
 * The API's base URL and bearer token, or null when either is unset (the site then runs on
 * fixtures). The trailing slash is stripped so paths never double up.
 */
export function readApiConfig(
  env: Record<string, string | undefined> = process.env,
): ApiRequestConfig | null {
  const baseUrl = env.CROSSCHAIN_API_URL;
  const token = env.EXPLORER_API_TOKEN;
  if (!baseUrl || !token) return null;
  return { baseUrl: baseUrl.replace(/\/$/, ""), token };
}

/** Test seam: the breaker is module state on purpose, and between cases that is noise. */
export function resetApiBreaker(): void {
  apiBreaker.reset();
}

/**
 * The upstream budget: one deadline per request, and a second attempt only when the first
 * provably never reached the API.
 *
 * A request without an answer is never re-issued. Aborting a fetch does not cancel the query
 * behind it, so re-issuing a slow one runs it twice on an API that is slow because it is busy.
 * A slow answer inside the deadline lands; a shorter per-attempt timeout would abort it and run
 * the same query again beside the first.
 *
 * A connection that fails outright (refused, reset, closed, DNS) or a 502 (the proxy could not
 * reach the API; it sets no response timeout, so a 502 never means a query still running) is
 * retried once with what is left of the deadline: a dead keep-alive socket fails at once and the
 * retry gets a fresh one. A connection that stalls silently cannot be told from a slow query, so
 * it waits out the deadline like one.
 *
 * Retrying cannot fabricate: a shape error propagates on the first attempt (the version-skew
 * tripwire), and an outage still rejects.
 */
const DEADLINE_MS = 9_000;
/** Below this, a retry could not get an answer in time and would only add load. */
const MIN_RETRY_BUDGET_MS = 1_000;
const RETRY_BACKOFF_MS = 100;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** undici's codes for a connection that failed before any answer could arrive. */
const CONNECTION_FAILURE_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EPIPE",
  "ENOTFOUND",
  "EAI_AGAIN",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
]);

function errorCode(value: unknown): string | null {
  if (typeof value !== "object" || value === null || !("code" in value)) return null;
  return typeof value.code === "string" ? value.code : null;
}

/**
 * Did this fetch fail at the connection, before the API could answer? Judged by the cause's
 * code rather than the message: Node wraps every network failure as "fetch failed". A
 * multi-address connect reports an AggregateError whose members carry the codes.
 */
function isConnectionFailure(error: unknown): boolean {
  if (!(error instanceof TypeError)) return false;
  const cause: unknown = error.cause;
  const code = errorCode(cause);
  if (code !== null) return CONNECTION_FAILURE_CODES.has(code);
  return (
    cause instanceof AggregateError &&
    cause.errors.some((member: unknown) => CONNECTION_FAILURE_CODES.has(errorCode(member) ?? ""))
  );
}

export async function apiRequest(
  config: ApiRequestConfig,
  path: string,
  revalidate: number,
): Promise<Response> {
  // An identifier must never climb out of the route it was put in (see `hasDotSegment`).
  if (hasDotSegment(path)) throw new Error(`refusing an API path with a dot segment: ${path}`);
  // Refuses at once while the API is known to be down. The breaker counts failed requests,
  // not attempts, so a connection blip is still absorbed by the retry below.
  apiBreaker.assertClosed(path);
  try {
    const res = await attemptRequest(config, path, revalidate);
    // The last attempt hands a 5xx back for the caller to reject on; that is still a failed
    // request as far as the API's health is concerned.
    if (res.status >= 500) apiBreaker.recordFailure();
    return res;
  } catch (err) {
    if (isTransientUpstream(err)) apiBreaker.recordFailure();
    throw err;
  }
}

async function attemptRequest(
  config: ApiRequestConfig,
  path: string,
  revalidate: number,
): Promise<Response> {
  const deadline = Date.now() + DEADLINE_MS;
  for (let attempt = 1; ; attempt += 1) {
    const remaining = deadline - Date.now();
    let res: Response;
    try {
      res = await fetch(`${config.baseUrl}${path}`, {
        headers: { authorization: `Bearer ${config.token}` },
        signal: AbortSignal.timeout(remaining),
        next: { revalidate },
      });
    } catch (err) {
      if (attempt === 1 && isConnectionFailure(err) && canRetry(deadline)) {
        await sleep(RETRY_BACKOFF_MS);
        continue;
      }
      throw err;
    }
    if (res.status === 502 && attempt === 1 && canRetry(deadline)) {
      await sleep(RETRY_BACKOFF_MS);
      continue;
    }
    /*
     * Every other status is returned for the caller to interpret: 404 means "does not exist",
     * any other 5xx is rejected by the caller as an outage. 429 is not retried: `/chain/*`
     * with a token is unthrottled, so a 429 there is a real instruction to back off.
     */
    if (res.status < 500) apiBreaker.recordSuccess();
    return res;
  }
}

function canRetry(deadline: number): boolean {
  return deadline - Date.now() - RETRY_BACKOFF_MS >= MIN_RETRY_BUDGET_MS;
}
