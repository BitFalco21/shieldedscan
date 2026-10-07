import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useDisplayNow } from "../use-display-now";

/**
 * The clock relative ages are measured against.
 *
 * Anchoring ages to the chain tip's timestamp would make the newest block read "0s ago"
 * until the next block replaced it, and indefinitely if the chain stalled. The wall clock is
 * the honest anchor, and `timeAgo` clamps at zero, so a miner timestamp ahead of real time
 * still reads "0s".
 *
 * It is a hook rather than `Date.now()` in the render for two reasons:
 *  - no hydration mismatch: it returns the server's value on the first render and only moves
 *    after mount, the same shape `HalvingCountdown` uses;
 *  - a reader's clock set behind the chain would report every block as "0s ago", so it takes
 *    the later of the two and falls back to the tip-anchored value.
 */

const SERVER_NOW = 1_800_000_000;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useDisplayNow", () => {
  it("returns the server's value on the first render", () => {
    // Anything else is a hydration mismatch: the server has already committed this number to
    // the HTML.
    vi.setSystemTime(SERVER_NOW * 1000);
    const { result } = renderHook(() => useDisplayNow(SERVER_NOW));

    expect(result.current).toBe(SERVER_NOW);
  });

  it("advances with real time after mount", async () => {
    vi.setSystemTime(SERVER_NOW * 1000);
    const { result } = renderHook(() => useDisplayNow(SERVER_NOW));

    vi.setSystemTime((SERVER_NOW + 15) * 1000);
    // `act`, because the update comes from a timer callback rather than a render.
    await act(async () => void (await vi.advanceTimersByTimeAsync(1_100)));

    // At least +15, not exactly: advancing the timers advances the mocked `Date` with them, so
    // pinning the precise second would assert fake-timer bookkeeping rather than the property.
    expect(result.current).toBeGreaterThanOrEqual(SERVER_NOW + 15);
  });

  it("never goes backwards from the server's value", async () => {
    // A reader whose clock is behind the chain would otherwise see every block as "0s ago".
    vi.setSystemTime((SERVER_NOW - 600) * 1000);
    const { result } = renderHook(() => useDisplayNow(SERVER_NOW));

    // `act`, because the update comes from a timer callback rather than a render.
    await act(async () => void (await vi.advanceTimersByTimeAsync(1_100)));

    expect(result.current).toBe(SERVER_NOW);
  });

  it("follows the server's value upward when a newer one arrives", async () => {
    // A new block moves the tip; the age of everything below it must move with it even if the
    // reader's clock disagrees.
    vi.setSystemTime(SERVER_NOW * 1000);
    const { result, rerender } = renderHook(({ now }) => useDisplayNow(now), {
      initialProps: { now: SERVER_NOW },
    });

    rerender({ now: SERVER_NOW + 300 });
    // `act`, because the update comes from a timer callback rather than a render.
    await act(async () => void (await vi.advanceTimersByTimeAsync(1_100)));

    expect(result.current).toBe(SERVER_NOW + 300);
  });

  it("stops ticking once unmounted", async () => {
    vi.setSystemTime(SERVER_NOW * 1000);
    const { result, unmount } = renderHook(() => useDisplayNow(SERVER_NOW));
    // `act`, because the update comes from a timer callback rather than a render.
    await act(async () => void (await vi.advanceTimersByTimeAsync(1_100)));
    const atUnmount = result.current;

    unmount();
    vi.setSystemTime((SERVER_NOW + 120) * 1000);
    await act(async () => void (await vi.advanceTimersByTimeAsync(5_000)));

    expect(result.current).toBe(atUnmount);
  });
});
