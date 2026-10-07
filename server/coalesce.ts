/**
 * Coalesce concurrent identical reads into one upstream call and hold the answer briefly.
 *
 * Single-flight is the real protection: without it, N simultaneous misses each fan out to the
 * node, so N readers share one upstream call whatever N is. The TTL stays well under the
 * 75-second block target, so a tip page is at most one block stale; confirmed blocks are
 * immutable. Shared by `/chain/blocks` and `/chain/pulse/*` so both use one mechanism.
 */
export function coalesced<T>(ttlMs: number): (key: string, fetch: () => Promise<T>) => Promise<T> {
  const fresh = new Map<string, { at: number; value: T }>();
  const inFlight = new Map<string, Promise<T>>();
  return (key, fetch) => {
    const hit = fresh.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return Promise.resolve(hit.value);
    const running = inFlight.get(key);
    if (running) return running;
    const p = fetch()
      .then((value) => {
        fresh.set(key, { at: Date.now(), value });
        // Bounded: a cursored list has unboundedly many keys, and this must not become a leak.
        if (fresh.size > 200) {
          for (const k of fresh.keys()) {
            if (fresh.size <= 100) break;
            fresh.delete(k);
          }
        }
        return value;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, p);
    return p;
  };
}
