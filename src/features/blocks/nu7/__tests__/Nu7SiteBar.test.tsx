import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { NU7_HEIGHT, blockSummaryOf } from "@/domain";
import { blocks as fixtureBlocks } from "@/fixtures/blocks";
import { Nu7SiteBar } from "../Nu7SiteBar";
import { NU7_BAR_LIVE_SECONDS } from "../nu7-bar";

const path = vi.hoisted(() => ({ current: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => path.current }));

const T = 1_799_000_000;

function answer(height: number, tipTime = T, activationTime = T) {
  const body = {
    kind: "all",
    direction: "all",
    tip: { height, hash: `h${height}`, lastBlockTimestamp: tipTime },
    blocks:
      height >= NU7_HEIGHT
        ? [
            {
              ...blockSummaryOf(fixtureBlocks[0]!),
              height: NU7_HEIGHT,
              hash: "act",
              timestamp: activationTime,
            },
          ]
        : [],
    transactions: [],
    transfers: [],
  };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => body }));
}

async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T * 1000);
  path.current = "/";
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Nu7SiteBar", () => {
  it("renders the static line on the server", () => {
    const html = renderToString(<Nu7SiteBar testnet={false} />);
    expect(html).toContain("activates at block");
    expect(html).toContain("3,543,405");
    expect(html).toContain(`href="/block/${NU7_HEIGHT}"`);
  });

  it("fills in the time and blocks left after its first read", async () => {
    answer(NU7_HEIGHT - 412);
    render(<Nu7SiteBar testnet={false} />);
    await settle();
    expect(screen.getByRole("link").textContent).toMatch(
      /activates in about ~?9 h · 412 blocks to go/,
    );
  });

  it("keeps the static line when the read fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    render(<Nu7SiteBar testnet={false} />);
    await settle();
    expect(screen.getByRole("link").textContent).toContain("activates at block 3,543,405");
  });

  it("hides for this page view when closed", async () => {
    answer(NU7_HEIGHT - 412);
    render(<Nu7SiteBar testnet={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Hide for this page view" }));
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders nothing on testnet or on the countdown itself", () => {
    answer(NU7_HEIGHT - 412);
    const { container, rerender } = render(<Nu7SiteBar testnet />);
    expect(container.innerHTML).toBe("");
    path.current = `/block/${NU7_HEIGHT}`;
    rerender(<Nu7SiteBar testnet={false} />);
    expect(container.innerHTML).toBe("");
  });

  it("says live after activation, and nothing a day after the activation block", async () => {
    answer(NU7_HEIGHT + 5, T + 125, T);
    const { unmount } = render(<Nu7SiteBar testnet={false} />);
    await settle();
    expect(screen.getByRole("link").textContent).toContain(
      "live · activated at block 3,543,405 · blocks every ~25 s",
    );
    unmount();

    answer(NU7_HEIGHT + 3_456, T + NU7_BAR_LIVE_SECONDS, T);
    const { container } = render(<Nu7SiteBar testnet={false} />);
    await settle();
    expect(container.innerHTML).toBe("");
  });
});
