import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stats as fixtureStats } from "@/fixtures/stats";
import { useLiveStats } from "../useLiveStats";

/**
 * The `/stats` poller follows the same two rules as `use-live-feed.ts`: a hidden tab is not
 * polled, and an outage is polled once a minute rather than at full cadence.
 */
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
  vi.restoreAllMocks();
});

describe("useLiveStats", () => {
  it("adopts a fresh stats payload", async () => {
    fetchMock.mockResolvedValue(ok({ ...fixtureStats, height: fixtureStats.height + 1 }));
    const { result } = renderHook(() => useLiveStats(fixtureStats, { intervalMs: 1_000 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_100);
    });
    expect(result.current.current.height).toBe(fixtureStats.height + 1);
    expect(result.current.unavailable).toBe(false);
  });

  it("says unavailable after three failures and then backs off to the slow cadence", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 } as Response);
    const { result } = renderHook(() =>
      useLiveStats(fixtureStats, { intervalMs: 1_000, unavailableIntervalMs: 10_000 }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_100);
    });
    expect(result.current.unavailable).toBe(true);
    const after3 = fetchMock.mock.calls.length;
    expect(after3).toBe(3);
    // At full cadence three more polls would land in these three seconds. Backed off, none do.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(fetchMock.mock.calls.length).toBe(after3);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7_100);
    });
    expect(fetchMock.mock.calls.length).toBe(after3 + 1);
  });

  it("does not poll a hidden tab", async () => {
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    fetchMock.mockResolvedValue(ok(fixtureStats));
    renderHook(() => useLiveStats(fixtureStats, { intervalMs: 100 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    hidden.mockRestore();
  });
});
