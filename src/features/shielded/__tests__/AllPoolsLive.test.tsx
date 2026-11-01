import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupplyBreakdown, ValuePoolName } from "@/domain";
import { NU7 } from "@/domain";
import { AllPoolsLive } from "../AllPoolsLive";

/**
 * The view's claims, not its arithmetic (`all-pools.test.ts` has that): every part is shown,
 * an unread figure says "unavailable" instead of a number, and a share names what it is of.
 */

const ZEC = 100_000_000;
const NU7_MAINNET = NU7.activationHeight.mainnet!;

function supply(over: Partial<SupplyBreakdown> = {}): SupplyBreakdown {
  return {
    height: NU7_MAINNET - 10,
    nsmZat: 0,
    pools: [
      { pool: "transparent", balanceZat: 12_000_000 * ZEC },
      { pool: "ironwood", balanceZat: 4_000_000 * ZEC },
      { pool: "orchard", balanceZat: 400_000 * ZEC },
      { pool: "sapling", balanceZat: 500_000 * ZEC },
      { pool: "sprout", balanceZat: 20_000 * ZEC },
      { pool: "lockbox", balanceZat: 80_000 * ZEC },
    ],
    ...over,
  };
}

const card = (name: string) => screen.getByRole("button", { name: new RegExp(name) });

beforeEach(() => {
  // The poll never answers: these tests are about the server's read.
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise(() => {})),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AllPoolsLive", () => {
  it("shows every part of the 21M with its balance and a named share", () => {
    render(<AllPoolsLive initial={supply()} />);
    for (const name of [
      "Transparent",
      "Ironwood",
      "Orchard",
      "Sapling",
      "Sprout",
      "Lockbox",
      "NSM",
    ]) {
      expect(card(name).textContent).toMatch(/ZEC.*of issued/);
    }
    expect(card("Still to mine").textContent).toMatch(/of 21M/);
    expect(screen.getByRole("img", { name: /^21 million ZEC by pool: Transparent/ })).toBeTruthy();
    expect(screen.getByText(/read at block/)).toBeTruthy();
  });

  it("counts the NSM from zero before NU7, and names when it starts", () => {
    render(<AllPoolsLive initial={supply()} />);
    expect(card("NSM").textContent).toMatch(/0 ZEC/);
    expect(card("NSM").textContent).toMatch(/from NU7 \(block 3,543,405\)/);
  });

  it("says unavailable, never a number, for an NSM it could not read after NU7", () => {
    render(<AllPoolsLive initial={supply({ nsmZat: null, height: NU7_MAINNET + 5 })} />);
    expect(card("NSM").textContent).toMatch(/unavailable/);
    // Issued and still-to-mine need the NSM, so they are unread too, and so is the bar.
    expect(screen.getByText("ISSUED").parentElement?.textContent).toMatch(/unavailable/);
    expect(screen.getByText("STILL TO MINE").parentElement?.textContent).toMatch(/unavailable/);
    expect(screen.queryByRole("img", { name: /21 million ZEC by pool/ })).toBeNull();
    expect(card("Sprout").textContent).toMatch(/unspendable since NU7/);
  });

  it("shows a missing pool as unavailable rather than leaving it out", () => {
    const pools = supply().pools.filter((p) => p.pool !== "sapling");
    render(<AllPoolsLive initial={supply({ pools })} />);
    expect(card("Sapling").textContent).toMatch(/unavailable/);
  });

  it("opens one card's panel at a time, Ironwood first", () => {
    render(<AllPoolsLive initial={supply()} />);
    const panel = () => document.getElementById("supply-part-panel")!;
    expect(card("Ironwood").getAttribute("aria-pressed")).toBe("true");
    expect(within(panel()).getByRole("link").getAttribute("href")).toBe("/charts/pool-usage");

    fireEvent.click(card("NSM"));
    expect(card("NSM").getAttribute("aria-pressed")).toBe("true");
    expect(card("Ironwood").getAttribute("aria-pressed")).toBe("false");
    expect(panel().textContent).toMatch(/No transactions/);
    expect(within(panel()).queryByRole("link")).toBeNull();
  });

  it("names a pool this build does not know, rather than dropping its ZEC", () => {
    const pools = [...supply().pools, { pool: "future" as ValuePoolName, balanceZat: 1 * ZEC }];
    render(<AllPoolsLive initial={supply({ pools })} />);
    expect(card("future").textContent).toMatch(/not known to this build/);
  });
});
