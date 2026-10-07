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
 * The upstream budget, spent as three chances rather than one.
 *
 * List routes run without the fetch Data Cache so they are always current, which means
 * every view makes several upstream calls and a single stall on the frontend→API path would
 * render the error page. Such stalls happen occasionally while the API itself answers in
 * well under a second.
 *
 * `ATTEMPT_TIMEOUT_MS * MAX_ATTEMPTS` keeps the worst-case wait at 12 seconds, spent as
 * three attempts; a stalled connection rarely completes, so a retry usually resolves fast.
 *
 * Retrying cannot fabricate: only `isTransientUpstream` failures are retried, so a shape
 * error propagates on the first attempt (the version-skew tripwire), and a persistent outage
 * still rejects.
 */
const ATTEMPT_TIMEOUT_MS = 4_000;
const MAX_ATTEMPTS = 3;
/** Short, because what is being retried is a stall rather than a busy upstream. */
const RETRY_BACKOFF_MS = 100;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function apiRequest(
  config: ApiRequestConfig,
  path: string,
  revalidate: number,
): Promise<Response> {
  // An identifier must never climb out of the route it was put in (see `hasDotSegment`).
  if (hasDotSegment(path)) throw new Error(`refusing an API path with a dot segment: ${path}`);
  // Refuses at once while the API is known to be down. The breaker counts failed requests,
  // not attempts, so a single stall is still absorbed by the retries below.
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
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetch(`${config.baseUrl}${path}`, {
        headers: { authorization: `Bearer ${config.token}` },
        signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
        next: { revalidate },
      });
      /*
       * A 5xx is the upstream failing rather than answering, so it earns another attempt.
       * Every other status is returned for the caller to interpret — including 404, which on
       * this API means "does not exist". 429 is not retried either: `/chain/*` with a token is
       * unthrottled, so a 429 there is a real instruction to back off.
       */
      if (res.status >= 500 && attempt < MAX_ATTEMPTS) {
        lastError = new Error(`chain API returned ${res.status} for ${path}`);
        await sleep(RETRY_BACKOFF_MS * attempt);
        continue;
      }
      // Any answer that is not a server failure — a 404 included — is the API alive.
      if (res.status < 500) apiBreaker.recordSuccess();
      return res;
    } catch (err) {
      // Anything that is not a stall or a 5xx is a contract problem: rethrow at once, so
      // version skew stays loud instead of being retried into a merely slower failure.
      if (!isTransientUpstream(err) || attempt === MAX_ATTEMPTS) throw err;
      lastError = err;
      await sleep(RETRY_BACKOFF_MS * attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`chain API unreachable for ${path}`);
}
