/**
 * A module-scoped memo for a slow, optional upstream read, for routes whose segment config
 * (`fetchCache = "force-no-store"`) makes Next's own caches decline to cache it.
 *
 * - A fresh value is served from memory until `ttlMs` passes.
 * - Concurrent callers share one in-flight load.
 * - A failed load is remembered for `failureCooldownMs`, so an outage costs one timeout rather
 *   than one per render; meanwhile the last good value is served, however old.
 * - A failure is never cached as a value: with nothing good to fall back on, `get` rejects, and
 *   during the cooldown it rejects with that same failure, so a caller can still tell an outage
 *   (rendered "unavailable") from a wrong shape (thrown).
 *
 * Only for values where staleness is harmless (a past daily close, which chains exist).
 */
export interface StaleMemo<T> {
  get(load: () => Promise<T>): Promise<T>;
  /** Test seam: the memo is module state, and a test that shares it with another is not one. */
  reset(): void;
}

export interface StaleMemoOptions {
  ttlMs: number;
  failureCooldownMs: number;
}

export function createStaleMemo<T>(options: StaleMemoOptions): StaleMemo<T> {
  let cache: { at: number; value: T } | null = null;
  let inflight: Promise<T> | null = null;
  let failure: { at: number; error: unknown } | null = null;

  return {
    async get(load) {
      if (cache && Date.now() - cache.at < options.ttlMs) return cache.value;
      if (failure && Date.now() - failure.at < options.failureCooldownMs) {
        if (cache) return cache.value;
        throw failure.error;
      }
      inflight ??= load()
        .then((value) => {
          cache = { at: Date.now(), value };
          failure = null;
          return value;
        })
        .catch((err: unknown) => {
          failure = { at: Date.now(), error: err };
          throw err;
        })
        .finally(() => {
          inflight = null;
        });
      try {
        return await inflight;
      } catch (err) {
        // A refresh that failed must not lose a value we already have.
        if (cache) return cache.value;
        throw err;
      }
    },
    reset() {
      cache = null;
      inflight = null;
      failure = null;
    },
  };
}
