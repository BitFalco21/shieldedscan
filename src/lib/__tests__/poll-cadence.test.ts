import { afterEach, describe, expect, it, vi } from "vitest";
import { FAILURES_BEFORE_UNAVAILABLE, MAX_CHASES, pollDelayMs, runPollLoop } from "../poll-cadence";

/**
 * One cadence rule for the three live pollers (`use-live-feed.ts`, `/stats`, `/pulse`). Each
 * backs off once unavailable: a 5xx is not CDN-cacheable, so every poll of an outage is an
 * origin invocation.
 */
const base = { intervalMs: 10_000, chaseMs: 3_000, unavailableIntervalMs: 60_000 };

describe("pollDelayMs", () => {
  it("polls at the ordinary interval while healthy", () => {
    expect(pollDelayMs({ ...base, failures: 0, blockDue: false, chasesLeft: 8 })).toEqual({
      delay: 10_000,
      chasing: false,
    });
  });

  it("chases while a block is due and the budget holds", () => {
    expect(pollDelayMs({ ...base, failures: 0, blockDue: true, chasesLeft: 1 }).chasing).toBe(true);
    expect(pollDelayMs({ ...base, failures: 0, blockDue: true, chasesLeft: 0 }).delay).toBe(10_000);
  });

  it("backs off once unavailable, and never chases an outage", () => {
    const r = pollDelayMs({
      ...base,
      failures: FAILURES_BEFORE_UNAVAILABLE,
      blockDue: true,
      chasesLeft: 8,
    });
    expect(r).toEqual({ delay: 60_000, chasing: false });
  });

  it("stays at full cadence below the threshold — one blip is not an outage", () => {
    expect(
      pollDelayMs({
        ...base,
        failures: FAILURES_BEFORE_UNAVAILABLE - 1,
        blockDue: false,
        chasesLeft: 8,
      }).delay,
    ).toBe(10_000);
  });
});

describe("runPollLoop", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const cadence = { intervalMs: 1_000, chaseMs: 100, unavailableIntervalMs: 5_000 };

  it("polls at once, then on the regular cadence", async () => {
    vi.useFakeTimers();
    const poll = vi.fn(async () => false);
    const stop = runPollLoop({ poll, failures: () => 0, ...cadence });
    await vi.advanceTimersByTimeAsync(0);
    expect(poll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(poll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(poll).toHaveBeenCalledTimes(2);
    stop();
  });

  it("chases a due block at most MAX_CHASES times in a row", async () => {
    vi.useFakeTimers();
    const poll = vi.fn(async () => true);
    const stop = runPollLoop({ poll, failures: () => 0, ...cadence });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(MAX_CHASES * cadence.chaseMs);
    expect(poll).toHaveBeenCalledTimes(1 + MAX_CHASES);
    // The budget is spent: the next poll waits the regular interval.
    await vi.advanceTimersByTimeAsync(cadence.chaseMs);
    expect(poll).toHaveBeenCalledTimes(1 + MAX_CHASES);
    await vi.advanceTimersByTimeAsync(cadence.intervalMs - cadence.chaseMs);
    expect(poll).toHaveBeenCalledTimes(2 + MAX_CHASES);
    stop();
  });

  it("backs off once the failure count says unavailable", async () => {
    vi.useFakeTimers();
    const poll = vi.fn(async () => false);
    const stop = runPollLoop({ poll, failures: () => FAILURES_BEFORE_UNAVAILABLE, ...cadence });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(cadence.unavailableIntervalMs - 1);
    expect(poll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(poll).toHaveBeenCalledTimes(2);
    stop();
  });

  it("stops scheduling and stops listening for visibility once torn down", async () => {
    vi.useFakeTimers();
    const poll = vi.fn(async () => false);
    const stop = runPollLoop({ poll, failures: () => 0, ...cadence });
    await vi.advanceTimersByTimeAsync(0);
    stop();
    await vi.advanceTimersByTimeAsync(10 * cadence.intervalMs);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it("polls immediately when a hidden tab becomes visible again", async () => {
    vi.useFakeTimers();
    const poll = vi.fn(async () => false);
    const stop = runPollLoop({ poll, failures: () => 0, ...cadence });
    await vi.advanceTimersByTimeAsync(0);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(poll).toHaveBeenCalledTimes(2);
    stop();
  });
});
