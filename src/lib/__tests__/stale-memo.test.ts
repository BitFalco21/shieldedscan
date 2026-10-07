import { afterEach, describe, expect, it, vi } from "vitest";
import { createStaleMemo } from "../stale-memo";

const options = { ttlMs: 1_000, failureCooldownMs: 100, unavailableMessage: "unavailable" };

afterEach(() => {
  vi.useRealTimers();
});

describe("createStaleMemo", () => {
  it("serves a fresh value from memory until the TTL passes", async () => {
    vi.useFakeTimers();
    const memo = createStaleMemo<number>(options);
    const load = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    expect(await memo.get(load)).toBe(1);
    expect(await memo.get(load)).toBe(1);
    vi.advanceTimersByTime(1_000);
    expect(await memo.get(load)).toBe(2);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight load between concurrent callers", async () => {
    const memo = createStaleMemo<number>(options);
    const load = vi.fn(() => Promise.resolve(7));
    expect(await Promise.all([memo.get(load), memo.get(load)])).toEqual([7, 7]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("keeps serving the last good value through a failed refresh and its cooldown", async () => {
    vi.useFakeTimers();
    const memo = createStaleMemo<number>(options);
    await memo.get(() => Promise.resolve(1));
    vi.advanceTimersByTime(1_000);
    const failing = vi.fn(() => Promise.reject(new Error("down")));
    expect(await memo.get(failing)).toBe(1);
    expect(await memo.get(failing)).toBe(1);
    expect(failing).toHaveBeenCalledTimes(1);
  });

  it("rejects with nothing to fall back on, and does not retry inside the cooldown", async () => {
    vi.useFakeTimers();
    const memo = createStaleMemo<number>(options);
    const failing = vi.fn(() => Promise.reject(new Error("down")));
    await expect(memo.get(failing)).rejects.toThrow("down");
    await expect(memo.get(failing)).rejects.toThrow("unavailable");
    expect(failing).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(100);
    await expect(memo.get(failing)).rejects.toThrow("down");
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it("forgets everything on reset", async () => {
    const memo = createStaleMemo<number>(options);
    await memo.get(() => Promise.resolve(1));
    memo.reset();
    expect(await memo.get(() => Promise.resolve(2))).toBe(2);
  });
});
