/**
 * Is this failure the upstream being slow or down, rather than the contract being wrong?
 *
 * The distinction matters: the shape validators (`isBlock`, `isTransaction`) are a version-skew
 * tripwire that must throw until the API serving a new field is live. Catching everything would
 * turn a skew into a permanent "temporarily unavailable" panel.
 *
 * Only an incomplete request (timeout, abort, connection failure, open circuit), a 5xx or a 429
 * is transient. Everything else, such as a shape that does not parse, is rethrown.
 */
export function isTransientUpstream(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  // AbortSignal.timeout() throws a TimeoutError DOMException; an aborted fetch, AbortError.
  if (error.name === "TimeoutError" || error.name === "AbortError") return true;
  // The circuit breaker refusing a call while the API is known to be down: an outage stated
  // quickly, rendered exactly as the outage it stands in for.
  if (error.name === "UpstreamOpenError") return true;
  // Node's fetch wraps connection failures in a TypeError with a cause, and a body cut off
  // mid-read (a socket closed while `res.json()` streams) in one that reads "terminated".
  if (error.name === "TypeError" && /fetch failed|^terminated$/i.test(error.message)) return true;
  // The adapter's own message for a non-ok response: "chain API returned 503 for months". A 429
  // is a rate limit (the keyless `/v1` routes have one): a wait, not a wrong contract.
  return /returned (5\d\d|429)\b/.test(error.message);
}

/**
 * The digest a transient failure carries out of the data source, so the error boundary can say
 * "didn't load" instead of "something broke". Production withholds an error's message from the
 * browser but not its digest, and Next keeps a digest the error already has.
 */
export const UPSTREAM_UNAVAILABLE_DIGEST = "UPSTREAM_UNAVAILABLE";

/** Stamps the digest on a transient failure that has none; returns the error either way. */
export function tagTransient(error: unknown): unknown {
  if (isTransientUpstream(error) && error instanceof Error && !("digest" in error)) {
    Object.assign(error, { digest: UPSTREAM_UNAVAILABLE_DIGEST });
  }
  return error;
}

/**
 * Run a read and resolve `null` if — and only if — it failed for a transient reason.
 *
 * A slow or dead upstream degrades the panel that needed it, never the page or the build,
 * while a shape error (version skew) still throws. Lets a page read its optional series in a
 * single `Promise.all`.
 */
export async function nullIfTransient<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    if (!isTransientUpstream(error)) throw error;
    return null;
  }
}
