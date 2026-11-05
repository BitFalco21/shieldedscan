import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { NU7_HEIGHT, blockSummaryOf } from "@/domain";
import { blocks as fixtureBlocks } from "@/fixtures/blocks";
import { NU7_ACTIVATION_MS, Nu7Countdown } from "../Nu7Countdown";
import { consumeNu7Watched } from "../nu7-arrival";

const refresh = vi.fn();
// Stable, as Next's router is: the refresh loop must not restart on every render.
const router = { refresh };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const T = 1_799_000_000;

function payload(height: number) {
  return {
    kind: "all",
    direction: "all",
    tip: { height, hash: `h${height}`, lastBlockTimestamp: T },
    blocks: [{ ...blockSummaryOf(fixtureBlocks[0]!), height, hash: `h${height}`, timestamp: T }],
    transactions: [],
    transfers: [],
  };
}

function feedAnswers(...heights: number[]) {
  const fetchMock = vi.fn();
  for (const h of heights) {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => payload(h) } as Response);
  }
  fetchMock.mockResolvedValue({ ok: true, json: async () => payload(heights.at(-1)!) });
  vi.stubGlobal("fetch", fetchMock);
}

function reducedMotion(on: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: on, addEventListener: () => {}, removeEventListener: () => {} })),
  );
}

/** Let the first poll's promises settle and the timers up to `ms` fire. */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T * 1000);
  refresh.mockClear();
  consumeNu7Watched();
  reducedMotion(false);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const seed = { tipHeight: NU7_HEIGHT - 412, tipTimestamp: T, recent: [] };

describe("Nu7Countdown", () => {
  it("shows the blocks to go, the estimate and the latest block from the feed", async () => {
    feedAnswers(NU7_HEIGHT - 3);
    const { container } = render(<Nu7Countdown {...seed} />);
    expect(document.querySelector(".nu7-count")?.textContent).toBe("412");
    await advance(0);
    expect(document.querySelector(".nu7-count")?.textContent).toBe("3");
    expect(container.textContent).toContain("blocks to go · est. ~");
    expect(container.textContent).toContain("in about 4 min");
    expect(screen.getByText("1.25")).toBeTruthy();
    expect(screen.getByText("0.4167")).toBeTruthy();
    expect(screen.getByRole("link", { name: `#${(NU7_HEIGHT - 3).toLocaleString("en-US")}` }));
  });

  it("keeps the last values and says it is reconnecting when the feed fails", async () => {
    feedAnswers(NU7_HEIGHT - 3);
    const fetchMock = vi.mocked(fetch);
    render(<Nu7Countdown {...seed} />);
    await advance(0);
    fetchMock.mockRejectedValue(new Error("down"));
    await advance(35_000);
    expect(screen.getByText(/reconnecting/)).toBeTruthy();
    expect(document.querySelector(".nu7-count")?.textContent).toBe("3");
  });

  it("plays the activation when the tip crosses, then refreshes until the block exists", async () => {
    feedAnswers(NU7_HEIGHT);
    render(<Nu7Countdown {...seed} />);
    await advance(0);
    expect(screen.getByRole("status").textContent).toContain("NU7 is active");
    expect(refresh).not.toHaveBeenCalled();

    await advance(NU7_ACTIVATION_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByText("loading the block…")).toBeTruthy();
    expect(consumeNu7Watched()).toBe(true);

    await advance(6_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("skips the animation under reduced motion and refreshes at once", async () => {
    reducedMotion(true);
    feedAnswers(NU7_HEIGHT);
    render(<Nu7Countdown {...seed} />);
    await advance(0);
    expect(screen.getByRole("status").textContent).toContain("NU7 is active");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("goes straight to refreshing when first rendered at or past the height", async () => {
    feedAnswers(NU7_HEIGHT + 1);
    render(<Nu7Countdown {...seed} tipHeight={NU7_HEIGHT} />);
    await advance(0);
    // The server has just answered without the block: the first retry waits an interval.
    expect(refresh).not.toHaveBeenCalled();
    await advance(6_100);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(consumeNu7Watched()).toBe(false);
  });
});
