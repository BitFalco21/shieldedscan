/**
 * A response cache keyed by query, for the public reads whose answer depends on a window: one
 * load per key at a time (concurrent callers share it), a TTL per entry, oldest evicted past
 * `max`, and a failure never stored — so the next caller retries rather than being served an
 * outage for the length of a TTL.
 */
export function createKeyedCache(opts: { now: () => number; max: number }) {
  const cache = new Map<string, { expires: number; body: unknown }>();
  const inflight = new Map<string, Promise<unknown>>();
  /** `ttlMs` may depend on the answer: a window that can no longer change is kept longer. */
  return async function cached<T>(
    key: string,
    ttlMs: number | ((body: T) => number),
    load: () => Promise<T>,
  ): Promise<T> {
    const hit = cache.get(key);
    if (hit && hit.expires > opts.now()) return hit.body as T;
    const running = inflight.get(key);
    if (running) return running as Promise<T>;
    const p = load()
      .then((body) => {
        cache.delete(key);
        cache.set(key, {
          expires: opts.now() + (typeof ttlMs === "function" ? ttlMs(body) : ttlMs),
          body,
        });
        while (cache.size > opts.max) {
          const oldest = cache.keys().next().value;
          if (oldest === undefined) break;
          cache.delete(oldest);
        }
        return body;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  };
}
