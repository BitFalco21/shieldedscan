import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CrossChainTransfer, Transaction } from "@/domain";
import { TxDetailPage } from "../TxDetailPage";

const base: Transaction = {
  txid: "ab".repeat(32),
  blockHeight: 2_481_032,
  blockHash: "0b".repeat(32),
  timestamp: 1_783_875_480,
  isCoinbase: false,
  version: 5,
  sizeBytes: 1000,
  lockTime: 0,
  expiryHeight: 2_481_072,
  rawHex: "050000800a27a726".repeat(20),
  feeZat: 10_000,
  bindingSigValid: true,
  transparentInputs: [],
  transparentOutputs: [],
  sprout: null,
  sapling: null,
  orchard: null,
  ironwood: null,
};

const fullyShielded: Transaction = {
  ...base,
  orchard: { actions: 2, valueBalanceZat: -10_000 },
  ironwood: null,
};

const transparent: Transaction = {
  ...base,
  transparentInputs: [{ address: "t1From", valueZat: 419_921_000 }],
  transparentOutputs: [
    { address: "t1ToA", valueZat: 400_000_000 },
    { address: "t1ToB", valueZat: 19_911_000 },
  ],
};

function renderPage(tx: Transaction) {
  render(<TxDetailPage tx={tx} tipHeight={2_481_040} priceUsd={38.42} />);
}

describe("TxDetailPage USD figures", () => {
  it("prices the public value and fee of a transparent transaction", () => {
    renderPage(transparent);
    // 4.19911 ZEC × $38.42 ≈ $161.33 — shown whole-dollar, since cents on a spot-price
    // approximation above $100 are noise (formatUsd's rule). The fee stays sub-cent.
    //
    // Twice, as one figure: under the action sentence (the amount it states) and in PUBLIC VALUE.
    expect(screen.getAllByText("≈ $161")).toHaveLength(2);
    expect(screen.getByText("≈ <$0.01")).toBeDefined();
  });

  it("states the fee in the facts, not again under the action sentence", () => {
    // The fee is stated in FEE (with its dollar value); the flow arrow keeps it as the term
    // reconciling the two totals. The action box does not repeat it.
    renderPage(transparent);
    const action = screen.getByRole("region", { name: "What happened" });
    expect(action.textContent).not.toMatch(/fee/i);
    expect(screen.getByText("0.0001 ZEC")).toBeDefined();
  });

  it("never puts a dollar figure beside a veiled value", () => {
    renderPage(fullyShielded);
    // The fee is public and priced; the value is veiled, so exactly one USD figure.
    // The Veil appears in the action sentence and in the VALUE fact; neither is priced.
    expect(screen.getAllByRole("img", { name: /value shielded/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/≈/)).toHaveLength(1);
  });

  it("drops the dollar line, keeping the ZEC amount, when the price feed is cold", () => {
    // A cold price feed yields null. The ZEC figure is the fact and must survive; the conversion
    // simply goes away.
    render(<TxDetailPage tx={transparent} tipHeight={2_481_040} priceUsd={null} />);
    // Appears in both the summary table and the flow panel, hence getAllByText.
    expect(screen.getAllByText("4.19911 ZEC").length).toBeGreaterThan(0);
    expect(screen.queryByText(/≈/)).toBeNull();
    expect(screen.queryByText(/\$/)).toBeNull();
    // Not "unavailable" either: this is the one place a missing price needs no words, and
    // announcing it four times down a detail table would be noise, not honesty.
    expect(screen.queryByText("unavailable")).toBeNull();
  });
});

describe("TxDetailPage facts", () => {
  it("leads the block cell with its height, and links it", () => {
    // The hash is what a reader copies; the height is what they read.
    renderPage(transparent);
    expect(screen.getByText("0 (no lock)")).toBeDefined();
    const blockLink = screen.getByRole("link", { name: "#2,481,032" });
    expect(blockLink.getAttribute("href")).toBe("/block/2481032");
  });

  it("keeps the block hash beside the height, copyable and in full", () => {
    // Dropping it would lose the one identifier that names this exact block across a reorg.
    renderPage(transparent);
    expect(screen.getByTitle("0b".repeat(32))).toBeDefined();
    // Named "block hash", not the generic "hash": this page carries one copy button per
    // transparent input and output too, and a dozen identical spoken names is no name.
    expect(screen.getByRole("button", { name: /copy block hash/i })).toBeDefined();
  });

  it("makes the block hash a link to the block, in the same tab", () => {
    // A plain-text hash beside a clickable height reads as a dead control.
    renderPage(transparent);
    const hashLink = screen.getByTitle("0b".repeat(32));
    expect(hashLink.tagName).toBe("A");
    expect(hashLink.getAttribute("href")).toBe(`/block/${"0b".repeat(32)}`);
    // Same tab: a new window for an internal destination loses the back button and the
    // App Router navigation with it.
    expect(hashLink.getAttribute("target")).toBeNull();
  });

  it("puts the block ahead of the expiry height", () => {
    // The block that mined this transaction must not sit below the height at which it would have
    // stopped being mineable. Asserted as an order over the rendered labels, not an index, so a new
    // fact does not break it.
    renderPage(transparent);
    const labels = Array.from(document.querySelectorAll(".microlabel")).map((el) =>
      (el.textContent ?? "").trim(),
    );
    const block = labels.findIndex((l) => l.startsWith("BLOCK"));
    const expiry = labels.findIndex((l) => l.startsWith("EXPIRY HEIGHT"));
    expect(block).toBeGreaterThanOrEqual(0);
    expect(expiry).toBeGreaterThanOrEqual(0);
    expect(block).toBeLessThan(expiry);
  });

  it("puts every value cell ahead of every plumbing cell", () => {
    // Value cells must lead the grid, ahead of encoding plumbing (RAW SIZE, VERSION, BINDING SIG).
    //
    // Asserted as the property rather than a sequence: a new fact placed anywhere sensible keeps
    // this green; only a value cell sinking below the plumbing turns it red. `orchardToIronwood`
    // renders two pool cells, so the conditional prefix is covered.
    render(<TxDetailPage tx={orchardToIronwood} priceUsd={null} tipHeight={3_430_557} />);

    const VALUE = ["ORCHARD VALUE BALANCE", "IRONWOOD VALUE BALANCE", "PUBLIC VALUE", "FEE"];
    const PLUMBING = ["BINDING SIG", "VERSION", "RAW SIZE"];

    // Exact equality, never a prefix: `.microlabel` is also the breadcrumb, the panel titles
    // and the flow panels' own labels, and a `startsWith` would let one of those satisfy the
    // order the grid is supposed to be holding.
    //
    // Read from the label's own FIRST TEXT NODE rather than its `textContent`, because an
    // InfoTip renders its `?` and the whole hint sentence inside this same element — so
    // `textContent` on a hinted cell is "PUBLIC VALUE?The total on transparent outputs…" and
    // matches nothing. That is why the block/expiry test above settles for `startsWith`.
    const labels = Array.from(document.querySelectorAll(".microlabel")).map((el) =>
      (el.childNodes[0]?.textContent ?? "").trim(),
    );
    const at = (label: string) => {
      const index = labels.indexOf(label);
      expect(index, `${label} is not on the page at all`).toBeGreaterThanOrEqual(0);
      return index;
    };

    const lastValue = Math.max(...VALUE.map(at));
    const firstPlumbing = Math.min(...PLUMBING.map(at));
    expect(
      lastValue,
      `a value cell sits below the plumbing — labels rendered: ${labels.join(" | ")}`,
    ).toBeLessThan(firstPlumbing);
  });

  it("shows a mempool transaction as pending rather than linking a block", () => {
    renderPage({ ...transparent, blockHeight: null, blockHash: null });
    expect(screen.getByText(/pending — not yet in a block/)).toBeDefined();
    expect(screen.getByText(/Unconfirmed — in the mempool/)).toBeDefined();
  });

  it("labels a value balance with its direction from the domain sign", () => {
    renderPage(fullyShielded);
    // −0.0001 ZEC: the fee left the pool. Domain sign, not the RPC's inverse. The words and
    // the sign carry the direction; the arrow is only a connector to the phrase.
    expect(screen.getByText(/→ out of the Orchard pool/)).toBeDefined();
  });

  it("points the arrow the same way whichever way the value moved", () => {
    // The property, not golden strings: a connector cannot contradict the preposition beside it,
    // and this fails if a leftward arrow is reintroduced here.
    renderPage(orchardToIronwood);
    const text = document.body.textContent ?? "";

    expect(text).toMatch(/→ into the Ironwood pool/);
    expect(text).toMatch(/→ out of the Orchard pool/);
    // Scoped to this sentence rather than sweeping the page for "←": a back-link or a
    // prev/next control is a genuine direction and must stay allowed.
    expect(text).not.toMatch(/←\s*(into|out of)/);
  });

  it("offers the raw transaction collapsed, with a copy affordance", () => {
    renderPage(transparent);
    expect(screen.getByText(/RAW TRANSACTION/)).toBeDefined();
    expect(screen.getByRole("button", { name: /copy raw transaction hex/i })).toBeDefined();
  });

  it("omits the raw section when the hex was not carried", () => {
    renderPage({ ...transparent, rawHex: null });
    expect(screen.queryByText(/RAW TRANSACTION/)).toBeNull();
  });
});

/**
 * Mainnet transaction 00553613…9d47 (block 3,429,408), an Orchard → Ironwood migration: each flow
 * panel must name its own pool, and the net must not be labelled as the pool's own change.
 *
 * Orchard −40,000 zat, Ironwood +20,000 zat, so 20,000 left the shielded side as the fee.
 */
const orchardToIronwood: Transaction = {
  ...base,
  feeZat: 20_000,
  orchard: { actions: 2, valueBalanceZat: -40_000 },
  ironwood: { actions: 2, valueBalanceZat: 20_000 },
};

describe("a turnstile migration names the pools it actually moved between", () => {
  it("titles the spending side with the pool losing value and the receiving side with the pool gaining it", () => {
    render(<TxDetailPage tx={orchardToIronwood} priceUsd={null} tipHeight={3_430_557} />);
    expect(screen.getByText("Orchard pool · spending")).toBeDefined();
    expect(screen.getByText("Ironwood pool · receiving")).toBeDefined();
    // Each side must name its own pool, not Orchard for both.
    expect(screen.queryByText("Orchard pool · receiving")).toBeNull();
  });

  it("does not label the all-pool net as if it belonged to one pool", () => {
    render(<TxDetailPage tx={orchardToIronwood} priceUsd={null} tipHeight={3_430_557} />);
    // −0.0002 is what left the shielded side altogether. Under "Ironwood · receiving",
    // calling that "NET TO POOL" asserts the opposite of what Ironwood did.
    expect(screen.queryByText("NET TO POOL")).toBeNull();
    expect(screen.getAllByText("NET TO SHIELDED").length).toBeGreaterThan(0);
  });
});

describe("named addresses in the flow panels", () => {
  // Both real: rank 2 and rank 12 of the live rich list, one attributed and one not.
  const EXCHANGE = "t1gsBrGZGMyDGZw2icGnMpVBuEGVWip5kH8";
  const UNNAMED = "t1cpC3SS8okUsMQwTqWgzyA1k237B3WCeco";

  const deposit: Transaction = {
    ...base,
    transparentInputs: [{ address: UNNAMED, valueZat: 500_010_000 }],
    transparentOutputs: [{ address: EXCHANGE, valueZat: 500_000_000 }],
  };

  it("shows the name in place of the address on both sides", () => {
    renderPage(deposit);
    expect(screen.getByRole("link", { name: "Binance Cold Wallet" })).toBeDefined();
    // …and leaves the unnamed side as an address, which is the whole point of the fallback.
    expect(screen.getByRole("link", { name: /t1cpC/ })).toBeDefined();
  });

  it("keeps the address checkable behind the name", () => {
    // A third-party attribution a reader cannot check against the address is a bare claim.
    renderPage(deposit);
    expect(screen.getByRole("link", { name: "Binance Cold Wallet" }).getAttribute("title")).toBe(
      EXCHANGE,
    );
  });

  it("still links the name to the address's own page", () => {
    renderPage(deposit);
    expect(screen.getByRole("link", { name: "Binance Cold Wallet" }).getAttribute("href")).toBe(
      `/address/${EXCHANGE}`,
    );
  });

  it("prints no basis beside the name", () => {
    const { container } = render(
      <TxDetailPage tx={deposit} tipHeight={2_481_040} priceUsd={38.42} />,
    );
    expect(container.textContent).not.toMatch(/third-party|self-declared|arkm/i);
  });
});

describe("raw hex is on the page exactly once", () => {
  it("renders the hex in one element and hands neither button a copy of it", () => {
    const hex = "050000800a27a726".repeat(20);
    const { container } = render(
      <TxDetailPage tx={{ ...transparent, rawHex: hex }} tipHeight={2_481_040} priceUsd={38.42} />,
    );
    const occurrences = container.innerHTML.split(hex).length - 1;
    expect(occurrences).toBe(1);
    expect(container.querySelector("#raw-hex")?.textContent).toBe(hex);
  });
});

describe("TxDetailPage swap leg", () => {
  const crossing: CrossChainTransfer = {
    id: "near-5502",
    direction: "in",
    protocol: "near-intents",
    counterpartChain: "BTC",
    counterpartAsset: "BTC",
    counterpartAmount: 0.5,
    counterpartTxHash: null,
    counterpartIsSynthetic: false,
    counterpartAddress: null,
    zcashTxid: base.txid,
    zcashAddress: null,
    zecAmountZat: 4_000_000_000,
    usdValueAtSwap: null,
    counterpartUsdAtSwap: null,
    venueDepositAddress: null,
    status: "completed",
    timestamp: 1_783_875_480,
  };

  it("names the swap this transaction is a leg of and links to it", () => {
    render(
      <TxDetailPage
        tx={fullyShielded}
        tipHeight={2_481_040}
        priceUsd={null}
        crossings={{ transfers: [crossing], total: 1 }}
      />,
    );
    const link = screen.getByRole("link", { name: /Zcash leg of a swap into Zcash/i });
    expect(link.getAttribute("href")).toBe("/cross-chain/near-5502");
    expect(link.textContent).toContain("Swapped 0.5");
  });

  it("folds a batch past two strips, and states the exact total even when capped", () => {
    const batch = Array.from({ length: 5 }, (_, i) => ({ ...crossing, id: `near-b${i}` }));
    render(
      <TxDetailPage
        tx={fullyShielded}
        tipHeight={2_481_040}
        priceUsd={null}
        crossings={{ transfers: batch, total: 30 }}
      />,
    );
    expect(screen.getByText(/settled 30 crossings/)).toBeDefined();
    expect(screen.getByText("3 more crossings")).toBeDefined();
    expect(screen.getByText("Showing 5 of 30.")).toBeDefined();
    // All five render (two open, three inside the disclosure) — none is dropped.
    expect(
      screen.getAllByRole("link", { name: /Zcash leg of a swap/i, hidden: true }),
    ).toHaveLength(5);
  });

  it("draws no strip for a transaction that crossed nothing", () => {
    renderPage(fullyShielded);
    expect(screen.queryByText(/Zcash leg of a swap/i)).toBeNull();
  });
});
