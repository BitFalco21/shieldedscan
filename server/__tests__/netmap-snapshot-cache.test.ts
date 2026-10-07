import { describe, expect, it } from "vitest";
import { createSnapshotCache } from "../netmap/snapshot";

/**
 * The reader's cache serves the last snapshot while a re-read runs, so no visitor or ISR
 * revalidation waits on a multi-second rebuild. A clock and a controllable loader stand in for
 * time and Postgres.
 */
function harness() {
  let t = 1_000_000;
  const clock = () => t;
  const advance = (ms: number) => {
    t += ms;
  };
  let calls = 0;
  const pending: Array<{ resolve: (v: string) => void; reject: (e: Error) => void }> = [];
  const load = () =>
    new Promise<string>((resolve, reject) => {
      calls += 1;
      pending.push({ resolve, reject });
    });
  const cache = createSnapshotCache(load, clock, 30_000, 300_000);
  const settle = (i: number) => {
    const p = pending[i];
    if (!p) throw new Error(`no load #${i} in flight`);
    return p;
  };
  return { cache, advance, settle, calls: () => calls };
}

describe("createSnapshotCache", () => {
  it("a cold reader waits for the first load, and readers inside the fresh window share it", async () => {
    const h = harness();
    const a = h.cache.read();
    const b = h.cache.read();
    expect(h.calls()).toBe(1);
    h.settle(0).resolve("one");
    expect(await a).toBe("one");
    expect(await b).toBe("one");
    h.advance(10_000);
    expect(await h.cache.read()).toBe("one");
    expect(h.calls()).toBe(1);
  });

  it("past the fresh window a reader is served the last snapshot AT ONCE while one re-read runs", async () => {
    const h = harness();
    const first = h.cache.read();
    h.settle(0).resolve("one");
    await first;
    h.advance(31_000);
    // Both readers get the stale value immediately; only one load is started for both.
    expect(await h.cache.read()).toBe("one");
    expect(await h.cache.read()).toBe("one");
    expect(h.calls()).toBe(2);
    h.settle(1).resolve("two");
    await Promise.resolve();
    await Promise.resolve();
    expect(await h.cache.read()).toBe("two");
    expect(h.calls()).toBe(2);
  });

  it("a failed re-read keeps the last good snapshot and the next reader tries again", async () => {
    const h = harness();
    const first = h.cache.read();
    h.settle(0).resolve("one");
    await first;
    h.advance(31_000);
    expect(await h.cache.read()).toBe("one");
    h.settle(1).reject(new Error("postgres down"));
    await Promise.resolve();
    await Promise.resolve();
    // Still stale, still served; a new load starts because the failed one released the flight.
    expect(await h.cache.read()).toBe("one");
    expect(h.calls()).toBe(3);
  });

  it("past the stale ceiling a reader WAITS on the re-read, so an outage reaches the page", async () => {
    const h = harness();
    const first = h.cache.read();
    h.settle(0).resolve("one");
    await first;
    h.advance(300_001);
    const late = h.cache.read();
    let settled = false;
    void late.then(
      () => {
        settled = true;
      },
      () => {},
    );
    await Promise.resolve();
    expect(settled).toBe(false);
    h.settle(1).reject(new Error("postgres down"));
    await expect(late).rejects.toThrow("postgres down");
  });
});
