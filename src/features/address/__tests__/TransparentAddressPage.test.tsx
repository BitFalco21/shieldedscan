import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { TransparentAddress } from "@/domain";
import { TransparentAddressPage } from "../TransparentAddressPage";

const info: TransparentAddress = {
  kind: "transparent",
  address: "t1Kf1WcYiXqZ6ZQ3nJ8sVX1kX4nRhcYVKuZ",
  balanceZat: 100_000_000, // 1 ZEC
  totalReceivedZat: 1_000_00000000, // 1,000 ZEC
  totalSentZat: 999_00000000, // 999 ZEC
  txids: [],
};

const renderPage = (priceUsd: number | null) =>
  render(
    <TransparentAddressPage
      info={info}
      txs={[]}
      now={1_785_000_000}
      newerHref={null}
      olderHref={null}
      newestHref={null}
      oldestHref={null}
      priceUsd={priceUsd}
    />,
  );

/** A card's full text — the label, the ZEC figure and the dollar line are separate nodes. */
const card = (label: string) => screen.getByText(label).parentElement?.textContent ?? "";

describe("USD beside a transparent address's public figures", () => {
  it("prices all three, because a transparent balance is genuinely public", () => {
    renderPage(400);
    // 1 ZEC, 1,000 ZEC and 999 ZEC at $400. `formatUsd` drops cents above $100.
    expect(card("BALANCE")).toContain("≈ $400");
    expect(card("TOTAL RECEIVED")).toContain("≈ $400,000");
    expect(card("TOTAL SENT")).toContain("≈ $399,600");
  });

  it("qualifies the lifetime sums, so they cannot read as value-at-the-time", () => {
    renderPage(400);
    // A balance at a current price needs no qualifier; a decade of receipts does. Coins
    // received when ZEC was $30 are not "$400,000 received" in any sense these two numbers
    // support, and the qualifier is the whole difference between true and misleading.
    expect(card("TOTAL RECEIVED")).toMatch(/at today's price/);
    expect(card("TOTAL SENT")).toMatch(/at today's price/);
    expect(card("BALANCE")).not.toMatch(/at today's price/);
  });

  it("drops the dollar line silently when the price feed is cold", () => {
    renderPage(null);
    // Never "unavailable" three times down one row: the ZEC figure is the fact, the
    // conversion a convenience. Same trade TxDetailPage makes.
    for (const label of ["BALANCE", "TOTAL RECEIVED", "TOTAL SENT"]) {
      expect(card(label)).not.toMatch(/\$/);
      expect(card(label)).not.toMatch(/unavailable/i);
      // The ZEC figure itself must survive a missing price.
      expect(card(label)).toMatch(/ZEC/);
    }
  });
});

describe("the name-tag chip", () => {
  /** Rank 2 of the live rich list, attributed to Binance. */
  const named: TransparentAddress = { ...info, address: "t1gsBrGZGMyDGZw2icGnMpVBuEGVWip5kH8" };

  const renderNamed = (over: TransparentAddress = named) =>
    render(
      <TransparentAddressPage
        info={over}
        txs={[]}
        now={1_785_000_000}
        newerHref={null}
        olderHref={null}
        newestHref={null}
        oldestHref={null}
        priceUsd={null}
      />,
    );

  it("shows the name below the heading", () => {
    renderNamed();
    expect(screen.getByText("Binance Cold Wallet")).toBeDefined();
  });

  it("keeps the address as the heading — the chip is an addition, not a replacement", () => {
    // This is the page a reader arrives at to see the address itself, so unlike /tx the
    // name never stands in for it.
    renderNamed();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain(named.address);
  });

  it("puts the tag icon before the name", () => {
    const { container } = renderNamed();
    const chip = container.querySelector("[data-name-tag]");
    expect(chip?.firstElementChild?.hasAttribute("data-label-icon")).toBe(true);
    expect(chip?.textContent).toBe("Binance Cold Wallet");
  });

  it("renders nothing at all when nobody has named the address", () => {
    const { container } = renderNamed(info);
    expect(container.querySelector("[data-name-tag]")).toBeNull();
  });

  it("prints no basis beside the name", () => {
    const { container } = renderNamed();
    expect(container.textContent).not.toMatch(/third-party|self-declared|arkm/i);
  });
});

describe("the flag banner", () => {
  const renderAt = (address: string) =>
    render(
      <TransparentAddressPage
        info={{ ...info, address }}
        txs={[]}
        now={1_785_000_000}
        newerHref={null}
        olderHref={null}
        newestHref={null}
        oldestHref={null}
        priceUsd={null}
      />,
    );

  it.each([
    "t1WgMdtND8NF7NDUuYmq8MpMj1NTCXkMDVG",
    "t1SyhmRJ35RpGsyuLArsPLepyoiLcawLia5",
    "t1gNZpuHEpST6Yu99y1tVb9nKXetkinFgXg",
  ])("names who flagged %s and links to their post, sending no referrer", (address) => {
    const { container } = renderAt(address);
    const banner = container.querySelector("[data-address-flag]");
    expect(banner?.textContent).toMatch(/^This address was flagged by ZachXBT/);
    const link = banner?.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://t.me/investigations/364");
    expect(link?.getAttribute("rel")).toContain("noreferrer");
  });

  it("is absent on a labelled address nobody flagged", () => {
    const { container } = renderAt("t1gsBrGZGMyDGZw2icGnMpVBuEGVWip5kH8");
    expect(container.querySelector("[data-name-tag]")).not.toBeNull();
    expect(container.querySelector("[data-address-flag]")).toBeNull();
  });
});
