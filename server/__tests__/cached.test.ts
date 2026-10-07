import { afterEach, describe, expect, it, vi } from "vitest";
import { Cached } from "../cached";

/**
 * `Cached` is the analytics routes' only cache, many instances on a small connection pool. It
 * must be single-flight: two concurrent cold misses must share one `load()`, or a slow query fans
 * out per concurrent reader.
 */
describe("Cached", () => {
  it("runs one load for concurrent misses and hands every caller the same value", async () => {
    const cache = new Cached<number>(60_000);
    let loads = 0;
    const load = () =>
      new Promise<number>((resolve) => {
        loads += 1;
        setTimeout(() => resolve(loads), 5);
      });
    const [a, b, c] = await Promise.all([cache.get(load), cache.get(load), cache.get(load)]);
    expect(loads).toBe(1);
    expect([a, b, c]).toEqual([1, 1, 1]);
  });

  it("never stores a failure, and lets the next caller try again", async () => {
    const cache = new Cached<number>(60_000);
    let calls = 0;
    const failing = async () => {
      calls += 1;
      throw new Error("down");
    };
    await expect(cache.get(failing)).rejects.toThrow("down");
    await expect(cache.get(failing)).rejects.toThrow("down");
    expect(calls).toBe(2);
    expect(await cache.get(async () => 9)).toBe(9);
  });
});

describe("Cached with a stale window", () => {
  afterEach(() => vi.useRealTimers());

  it("answers with the held value at once while one refresh runs behind it", async () => {
    vi.useFakeTimers({ now: 0 });
    const cache = new Cached<string>(1_000, { staleMs: 5_000 });
    expect(await cache.get(async () => "first")).toBe("first");

    vi.setSystemTime(2_000); // expired, inside the window
    let release!: (v: string) => void;
    let loads = 0;
    const slow = () => {
      loads += 1;
      return new Promise<string>((resolve) => {
        release = resolve;
      });
    };
    // Neither caller waits for the reload, and the two share it.
    expect(await cache.get(slow)).toBe("first");
    expect(await cache.get(slow)).toBe("first");
    expect(loads).toBe(1);
    release("second");
    await Promise.resolve();
    await Promise.resolve();
    expect(await cache.get(slow)).toBe("second");
  });

  it("keeps the held value when the refresh fails, and makes the caller wait once the window closes", async () => {
    vi.useFakeTimers({ now: 0 });
    const cache = new Cached<string>(1_000, { staleMs: 5_000 });
    await cache.get(async () => "held");
    const failing = async (): Promise<string> => {
      throw new Error("down");
    };

    vi.setSystemTime(2_000);
    expect(await cache.get(failing)).toBe("held");
    await Promise.resolve();
    expect(await cache.get(failing)).toBe("held");

    vi.setSystemTime(7_000); // past TTL + window: an outage reaches the caller as a failure
    await expect(cache.get(failing)).rejects.toThrow("down");
  });

  it("without a window, an expired value waits for its reload as before", async () => {
    vi.useFakeTimers({ now: 0 });
    const cache = new Cached<string>(1_000);
    await cache.get(async () => "old");
    vi.setSystemTime(2_000);
    expect(await cache.get(async () => "new")).toBe("new");
  });
});
