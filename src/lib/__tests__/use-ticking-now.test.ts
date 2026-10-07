import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTickingNow } from "../use-ticking-now";

afterEach(() => {
  vi.useRealTimers();
});

describe("useTickingNow", () => {
  it("starts at zero, ticks at once and then every interval while running", () => {
    vi.useFakeTimers({ now: 1_000 });
    const { result } = renderHook(() => useTickingNow(true, 500));
    expect(result.current).toBe(0);
    act(() => void vi.advanceTimersByTime(0));
    expect(result.current).toBe(1_000);
    act(() => void vi.advanceTimersByTime(500));
    expect(result.current).toBe(1_500);
  });

  it("never ticks while stopped, and keeps its last value when stopped", () => {
    vi.useFakeTimers({ now: 1_000 });
    const { result, rerender } = renderHook(({ running }) => useTickingNow(running, 500), {
      initialProps: { running: false },
    });
    act(() => void vi.advanceTimersByTime(2_000));
    expect(result.current).toBe(0);
    rerender({ running: true });
    act(() => void vi.advanceTimersByTime(0));
    expect(result.current).toBe(3_000);
    rerender({ running: false });
    act(() => void vi.advanceTimersByTime(2_000));
    expect(result.current).toBe(3_000);
  });
});
