import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CrossChainProtocolStats, CrossChainProtocolSummary } from "@/domain";
import {
  CrossChainProtocolsPage,
  SHARE_CELLS,
  protocolSharePct,
  shareCells,
} from "../CrossChainProtocolsPage";

const NOW = 1_790_950_000;
const side = (transfers: number, zat: number, usd: number, covered = transfers) => ({
  transfers,
  zecAmountZat: zat,
  usdAtSwap: usd,
  usdCoveredTransfers: covered,
});

function protocol(over: Partial<CrossChainProtocolStats>): CrossChainProtocolStats {
  return {
    protocol: "near-intents",
    in: side(3, 300e8, 120_000),
    out: side(1, 100e8, 40_000),
    chains: [{ key: "ETH", in: side(3, 300e8, 120_000), out: side(1, 100e8, 40_000) }],
    firstSeenAt: 1_743_378_339,
    lastSeenAt: NOW - 120,
    largest: {
      id: "near-big",
      direction: "in",
      counterpartChain: "BTC",
      zecAmountZat: 18_156_88366378,
      usdValueAtSwap: 4_361_491,
      timestamp: 1_772_010_376,
    },
    ...over,
  };
}

const summary = (protocols: CrossChainProtocolStats[]): CrossChainProtocolSummary => ({
  windowDays: null,
  windowStart: null,
  protocols,
});

describe("CrossChainProtocolsPage", () => {
  it("renders one card per protocol with its share of ZEC across the protocols", () => {
    render(
      <CrossChainProtocolsPage
        summary={summary([
          protocol({}),
          protocol({
            protocol: "maya",
            in: side(1, 100e8, 1),
            out: side(0, 0, 0),
            chains: [],
            largest: null,
          }),
        ])}
        range="all"
        now={NOW}
      />,
    );
    const near = screen.getByRole("region", { name: "NEAR Intents" });
    // 400 of 500 ZEC.
    expect(within(near).getByText("80.0%")).toBeTruthy();
    expect(within(near).getByText(/18,156\.88366378 ZEC/)).toBeTruthy();
    expect(within(near).getByText(/BTC → ZEC/)).toBeTruthy();
    expect(screen.getByRole("region", { name: "Maya Protocol" })).toBeTruthy();
  });

  it("marks swap-time dollars as a floor when a swap carried no price", () => {
    render(
      <CrossChainProtocolsPage
        summary={summary([protocol({ in: side(3, 300e8, 120_000, 2) })])}
        range="all"
        now={NOW}
      />,
    );
    const near = screen.getByRole("region", { name: "NEAR Intents" });
    expect(within(near).getAllByText(/^≥ \$160/)[0]).toBeTruthy();
  });

  it("says an idle protocol carried nothing in the window, and when it last did", () => {
    render(
      <CrossChainProtocolsPage
        summary={{
          windowDays: 30,
          windowStart: 1_788_393_600,
          protocols: [
            protocol({}),
            protocol({
              protocol: "maya",
              in: side(0, 0, 0),
              out: side(0, 0, 0),
              chains: [],
              largest: null,
              lastSeenAt: NOW - 40 * 86_400,
            }),
          ],
        }}
        range="30d"
        now={NOW}
      />,
    );
    const maya = screen.getByRole("region", { name: "Maya Protocol" });
    expect(within(maya).getByText("No swaps in the last 30 days.")).toBeTruthy();
    expect(within(maya).getByText("40d ago")).toBeTruthy();
  });

  it("states a failed largest-swap read as unavailable, never as none", () => {
    render(
      <CrossChainProtocolsPage
        summary={summary([protocol({ largest: "unavailable" })])}
        range="all"
        now={NOW}
      />,
    );
    const near = screen.getByRole("region", { name: "NEAR Intents" });
    expect(within(near).getByText("unavailable")).toBeTruthy();
    expect(within(near).queryByText("none")).toBeNull();
  });

  it("never rounds a share to 100% while another protocol carried ZEC", () => {
    expect(protocolSharePct(99.97)).toBe(">99.9%");
    expect(protocolSharePct(100)).toBe("100.0%");
    expect(protocolSharePct(0.01)).toBe("<0.1%");
  });

  it("lists every chain, with its figures, behind the +N more control", () => {
    const chains = ["ETH", "SOL", "BTC", "TRON", "NEAR"].map((key, i) => ({
      key,
      in: side(1, (5 - i) * 10e8, 1_000, 1),
      out: side(1, 0, 0, i === 4 ? 0 : 1),
    }));
    render(
      <CrossChainProtocolsPage
        summary={summary([protocol({ chains, in: side(5, 150e8, 4_000), out: side(5, 0, 0, 4) })])}
        range="all"
        now={NOW}
      />,
    );
    const card = screen.getByRole("region", { name: "NEAR Intents" });
    expect(within(card).getByText(/\+2 more/)).toBeTruthy();
    const table = within(card).getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(1 + chains.length);
    // NEAR: 10 of 150 ZEC, and a swap with no price makes its dollars a floor.
    const near = within(table).getByText("NEAR").closest("tr")!;
    expect(within(near).getByText("6.7%")).toBeTruthy();
    expect(within(near).getByText(/^≥ /)).toBeTruthy();
  });

  it("draws the share as cells, with a dim partial cell for the remainder", () => {
    const big = shareCells(90.6);
    expect(big).toHaveLength(SHARE_CELLS);
    expect(big.filter((c) => c === 1)).toHaveLength(45);
    expect(big[45]).toBeCloseTo(0.3);
    // A sliver is neither rounded up to a whole cell nor drawn as nothing.
    const sliver = shareCells(0.05);
    expect(sliver.filter((c) => c === 1)).toHaveLength(0);
    expect(sliver[0]).toBe(0.25);
    expect(shareCells(0).every((c) => c === 0)).toBe(true);
    expect(shareCells(100).every((c) => c === 1)).toBe(true);
  });
});
