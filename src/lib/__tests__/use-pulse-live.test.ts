import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PulseBlockPools, PulseFrame } from "@/domain";
import { PULSE_LIVE_KIND } from "@/data/pulse-payload";
import { usePulseLive } from "../use-pulse-live";

/**
 * The live transport, and the four things it must never do: believe an answer to a different
 * question, animate the poll that only establishes a baseline, keep accumulating after the
 * chain contradicted it, or go quiet while claiming to be live.
 *
 * The request is asserted, not just the state: an endpoint that stopped being called is
 * indistinguishable from a quiet chain from inside the state alone.
 */

const ZEC = 100_000_000;

const stocks = (height: number, hash: string): PulseBlockPools => ({
  height,
  hash,
  prevHash: "p".repeat(64),
  timestamp: 1_756_000_000 + height,
  receivedAt: 1_756_000_003 + height,
  pools: {
    transparent: 10 * ZEC,
    lockbox: 1 * ZEC,
    sprout: 1 * ZEC,
    sapling: 1 * ZEC,
    orchard: 1 * ZEC,
    ironwood: 1 * ZEC,
  },
});

const frameAt = (height: number, hash: string, tip = height): PulseFrame => ({
  window: { fromSeconds: 0, toSeconds: 1 },
  tip,
  stocks: stocks(height, hash),
  blocks: [
    {
      pools: stocks(height, hash),
      events: [],
      eventCount: 0,
      intervalSeconds: 75,
    },
  ],
  swaps: [],
  ledger: [],
});

const body = (frame: PulseFrame) => ({ kind: PULSE_LIVE_KIND, frame, pending: null });

const ok = (payload: unknown) => ({ ok: true, json: async () => payload }) as unknown as Response;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("usePulseLive", () => {
  it("asks /api/pulse/live, with no parameters to key a cache on", async () => {
    fetchMock.mockResolvedValue(ok(body(frameAt(100, "a"))));
    const initial = frameAt(99, "z");
    renderHook(() => usePulseLive({ initial }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/pulse/live");
  });

  it("accepts a frame and counts the poll, so the stage knows the first one is a baseline", async () => {
    fetchMock.mockResolvedValue(ok(body(frameAt(100, "a"))));
    const { result } = renderHook(() => usePulseLive({ initial: frameAt(99, "z") }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.polls).toBe(1);
    expect(result.current.frame.stocks.height).toBe(100);
    expect(result.current.status).toBe("live");
  });

  it("refuses a payload whose kind does not echo, and says so after three", async () => {
    // An answer to a different question. Counted as a failure on purpose: unsaid, the page
    // would sit still while claiming to be live.
    fetchMock.mockResolvedValue(ok({ kind: "something-else", frame: frameAt(100, "a") }));
    const { result } = renderHook(() =>
      usePulseLive({ initial: frameAt(99, "z"), intervalMs: 1_000 }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_100);
    });
    expect(result.current.status).toBe("unavailable");
    expect(result.current.polls).toBe(0);
  });

  it("halts and says so when a height we already saw reports a different hash", async () => {
    fetchMock
      .mockResolvedValueOnce(ok(body(frameAt(100, "a"))))
      .mockResolvedValue(ok(body(frameAt(100, "b"))));
    const { result } = renderHook(() =>
      usePulseLive({ initial: frameAt(99, "z"), intervalMs: 1_000 }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_100);
    });
    expect(result.current.status).toBe("reorganised");
    const calls = fetchMock.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    // Halted: continuing to accumulate under a "reorganised" banner would be the banner lying.
    expect(result.current.polls).toBe(1);
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(calls);
  });

  it("chases at the fast cadence while the payload's own tip is above its newest block", async () => {
    // The payload carries its own tell: the tip is read fresh while the blocks list is
    // coalesced, so a tip above the newest row means a block exists and has not shipped.
    fetchMock.mockResolvedValue(ok(body(frameAt(100, "a", 101))));
    renderHook(() => usePulseLive({ initial: frameAt(99, "z"), intervalMs: 10_000, chaseMs: 100 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
  });

  it("does not poll a hidden tab", async () => {
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    fetchMock.mockResolvedValue(ok(body(frameAt(100, "a"))));
    renderHook(() => usePulseLive({ initial: frameAt(99, "z"), intervalMs: 100 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    hidden.mockRestore();
  });

  it("does not poll at all when it is switched off", async () => {
    fetchMock.mockResolvedValue(ok(body(frameAt(100, "a"))));
    renderHook(() => usePulseLive({ initial: frameAt(99, "z"), enabled: false }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("usePulseLive back-off", () => {
  it("polls an outage once per slow interval instead of at full cadence", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 } as unknown as Response);
    const { result } = renderHook(() =>
      usePulseLive({ initial: frameAt(99, "z"), intervalMs: 1_000, unavailableIntervalMs: 10_000 }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_100);
    });
    expect(result.current.status).toBe("unavailable");
    const after = fetchMock.mock.calls.length;
    expect(after).toBe(3);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(fetchMock.mock.calls.length).toBe(after);
  });
});
