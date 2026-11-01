import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupplyBreakdown } from "@/domain";
import { SUPPLY_LIVE_KIND } from "@/data/supply-payload";
import { useLiveSupply } from "../useLiveSupply";

const initial: SupplyBreakdown = {
  height: 100,
  nsmZat: 0,
  pools: [{ pool: "transparent", balanceZat: 1_000 }],
};

const at = (height: number): SupplyBreakdown => ({ ...initial, height, nsmZat: height });
const ok = (payload: unknown) => ({ ok: true, json: async () => payload }) as unknown as Response;
const live = (supply: SupplyBreakdown) => ok({ kind: SUPPLY_LIVE_KIND, supply });

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

const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

describe("useLiveSupply", () => {
  it("shows the server's read, not yet claiming to be live", () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useLiveSupply(initial));
    expect(result.current).toEqual({ supply: initial, status: "waiting" });
  });

  it("adopts a newer block and says it is live", async () => {
    fetchMock.mockResolvedValue(live(at(101)));
    const { result } = renderHook(() => useLiveSupply(initial, { intervalMs: 1_000 }));
    await advance(10);
    expect(result.current.supply.height).toBe(101);
    expect(result.current.status).toBe("live");
  });

  it("never rolls the page back to an older copy", async () => {
    fetchMock.mockResolvedValue(live(at(99)));
    const { result } = renderHook(() => useLiveSupply(initial, { intervalMs: 1_000 }));
    await advance(10);
    expect(result.current.supply).toBe(initial);
  });

  it("adopts a newer server render, as after a refresh", () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    const { result, rerender } = renderHook(({ from }) => useLiveSupply(from), {
      initialProps: { from: initial },
    });
    rerender({ from: at(105) });
    expect(result.current.supply.height).toBe(105);
  });

  it("counts a payload it cannot read as a failure, and says so after three", async () => {
    fetchMock.mockResolvedValue(ok({ kind: "pulse-live" }));
    const { result } = renderHook(() =>
      useLiveSupply(initial, { intervalMs: 1_000, unavailableIntervalMs: 10_000 }),
    );
    await advance(2_100);
    expect(result.current.status).toBe("unavailable");
    expect(result.current.supply).toBe(initial);
    // Backed off: no poll at the regular cadence once unavailable.
    const calls = fetchMock.mock.calls.length;
    await advance(3_000);
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it("does not poll a hidden tab", async () => {
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    fetchMock.mockResolvedValue(live(at(101)));
    renderHook(() => useLiveSupply(initial, { intervalMs: 100 }));
    await advance(500);
    expect(fetchMock).not.toHaveBeenCalled();
    hidden.mockRestore();
  });
});
