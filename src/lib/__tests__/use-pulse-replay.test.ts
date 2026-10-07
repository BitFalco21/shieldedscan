import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PulseBlock, PulseWindowFrame } from "@/domain";
import { PULSE_WINDOW_SECONDS } from "@/domain";
import { pulseHourOf, usePulseReplay } from "../use-pulse-replay";

/**
 * The replay's reads, and the one failure nothing else could reveal.
 *
 * An hour of some other time is a well-formed hour: it animates perfectly, under the label the
 * reader chose, with nothing in the marks to give it away. So the request is asserted here and
 * the echo is refused in `parsePulseWindow` — a cache key is infrastructure configuration and
 * can regress silently, where a missing echo is a visible miss.
 */

const ZEC = 100_000_000;
const HOUR = PULSE_WINDOW_SECONDS;
const NOW = 1_756_000_000;

function block(height: number, timestamp: number): PulseBlock {
  return {
    pools: {
      height,
      hash: `hash-${height}`,
      prevHash: `hash-${height - 1}`,
      timestamp,
      receivedAt: timestamp,
      pools: {
        transparent: 1 * ZEC,
        lockbox: 1 * ZEC,
        sprout: 1 * ZEC,
        sapling: 1 * ZEC,
        orchard: 1 * ZEC,
        ironwood: 1 * ZEC,
      },
    },
    events: [],
    eventCount: 0,
    intervalSeconds: 75,
  };
}

const windowBody = (from: number, blocks: PulseBlock[]): PulseWindowFrame => ({
  applied: { fromSeconds: from, toSeconds: from + HOUR },
  blocks,
  swaps: [],
});

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

const urlsAsked = (): string[] => fetchMock.mock.calls.map((c) => String(c[0]));

describe("pulseHourOf", () => {
  it("aligns to the hour, so two adjacent requests cannot overlap", () => {
    expect(pulseHourOf(NOW)).toBe(Math.floor(NOW / HOUR) * HOUR);
    expect(pulseHourOf(pulseHourOf(NOW))).toBe(pulseHourOf(NOW));
  });
});

describe("usePulseReplay", () => {
  it("asks for ALIGNED hours, the clock's and two ahead", async () => {
    fetchMock.mockImplementation((url: string) => {
      const from = Number(new URL(url, "http://x").searchParams.get("from"));
      return Promise.resolve(ok(windowBody(from, [])));
    });
    const sim = NOW - 4 * HOUR;
    renderHook(() => usePulseReplay({ enabled: true, simSeconds: sim, nowSeconds: NOW }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const base = pulseHourOf(sim);
    expect(urlsAsked()).toEqual([
      `/api/pulse/window?from=${base}&to=${base + HOUR}`,
      `/api/pulse/window?from=${base + HOUR}&to=${base + 2 * HOUR}`,
      `/api/pulse/window?from=${base + 2 * HOUR}&to=${base + 3 * HOUR}`,
    ]);
  });

  it("never asks for the same hour twice", async () => {
    fetchMock.mockImplementation((url: string) => {
      const from = Number(new URL(url, "http://x").searchParams.get("from"));
      return Promise.resolve(ok(windowBody(from, [block(1, from + 10)])));
    });
    const sim = NOW - 4 * HOUR;
    const { rerender } = renderHook(
      (props: { sim: number }) =>
        usePulseReplay({ enabled: true, simSeconds: props.sim, nowSeconds: NOW }),
      { initialProps: { sim } },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const first = fetchMock.mock.calls.length;
    rerender({ sim: sim + 30 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock.mock.calls.length).toBe(first);
  });

  it("refuses an hour that is not the hour it asked for, and MARKS the hole", async () => {
    // The whole reason the echo exists. A hole is shown on the scrubber rather than retried
    // silently, so a quiet stretch is distinguishable from an hour we could not read.
    fetchMock.mockImplementation((url: string) => {
      const from = Number(new URL(url, "http://x").searchParams.get("from"));
      return Promise.resolve(ok(windowBody(from + HOUR, [block(9, from)])));
    });
    const sim = NOW - 4 * HOUR;
    const { result } = renderHook(() =>
      usePulseReplay({ enabled: true, simSeconds: sim, nowSeconds: NOW }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.blocks).toEqual([]);
    expect(result.current.failedHours).toContain(pulseHourOf(sim));
  });

  it("marks a failed read rather than accumulating nothing quietly", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 } as unknown as Response);
    const sim = NOW - 4 * HOUR;
    const { result } = renderHook(() =>
      usePulseReplay({ enabled: true, simSeconds: sim, nowSeconds: NOW }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.failedHours.length).toBeGreaterThan(0);
    expect(result.current.blocks).toEqual([]);
  });

  it("hands back blocks oldest first and never twice", async () => {
    fetchMock.mockImplementation((url: string) => {
      const from = Number(new URL(url, "http://x").searchParams.get("from"));
      return Promise.resolve(ok(windowBody(from, [block(from / HOUR, from + 5)])));
    });
    const sim = NOW - 4 * HOUR;
    const { result } = renderHook(() =>
      usePulseReplay({ enabled: true, simSeconds: sim, nowSeconds: NOW }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const heights = result.current.blocks.map((b) => b.pools.height);
    expect(heights).toEqual([...heights].sort((a, b) => a - b));
    expect(new Set(heights).size).toBe(heights.length);
  });

  it("puts an hour abandoned by OUR teardown back on the queue", async () => {
    // Every wanted hour is marked asked up front, and an abort returns before the rest reach
    // their own `finally`. Left there they would be neither refetched nor reported as a hole.
    let calls = 0;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      calls += 1;
      const from = Number(new URL(url, "http://x").searchParams.get("from"));
      if (calls === 1) {
        const error = new Error("aborted");
        error.name = "AbortError";
        void init;
        return Promise.reject(error);
      }
      return Promise.resolve(ok(windowBody(from, [block(1, from + 10)])));
    });
    const sim = NOW - 4 * HOUR;
    const { result, rerender } = renderHook(
      (props: { sim: number }) =>
        usePulseReplay({ enabled: true, simSeconds: props.sim, nowSeconds: NOW }),
      { initialProps: { sim } },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    // The abort took the whole queue with it: nothing loaded, and nothing was marked as a hole.
    expect(result.current.blocks).toEqual([]);
    expect(result.current.failedHours).toEqual([]);
    // Moving the clock into the next hour must ask again rather than sit on a silent gap.
    rerender({ sim: sim + HOUR });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    // The exact hour the abort abandoned, asked again and loaded. Asserting merely that some
    // block arrived would pass against the bug, because the hour beyond the abandoned queue was
    // never marked asked.
    expect(result.current.loadedHours).toContain(pulseHourOf(sim) + HOUR);
  });

  it("asks for nothing while it is switched off", async () => {
    renderHook(() => usePulseReplay({ enabled: false, simSeconds: NOW - HOUR, nowSeconds: NOW }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not ask for an hour that has not happened", async () => {
    fetchMock.mockImplementation((url: string) => {
      const from = Number(new URL(url, "http://x").searchParams.get("from"));
      return Promise.resolve(ok(windowBody(from, [])));
    });
    renderHook(() => usePulseReplay({ enabled: true, simSeconds: NOW, nowSeconds: NOW }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    for (const url of urlsAsked()) {
      const to = Number(new URL(url, "http://x").searchParams.get("to"));
      expect(to).toBeLessThanOrEqual(NOW + HOUR);
    }
  });
});
