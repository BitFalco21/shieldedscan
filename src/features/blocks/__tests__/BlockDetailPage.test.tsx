import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Block, Transaction } from "@/domain";
import { BlockDetailPage } from "../BlockDetailPage";

const block: Block = {
  height: 2_481_032,
  hash: "b1".repeat(32),
  prevHash: "b0".repeat(32),
  timestamp: 1_783_875_480,
  sizeBytes: 4000,
  txids: [],
  composition: { transparentTxs: 1, mixedTxs: 0, shieldedTxs: 1 },
  version: 4,
  difficulty: 146_914_688.75,
  bits: "1c00e9e0",
  nonce: "4e".repeat(32),
  merkleRoot: "4d".repeat(32),
  finalSaplingRoot: "5a".repeat(32),
  finalOrchardRoot: "04".repeat(32),
  miner: { kind: "transparent", address: "t1TheMiner" },
  coinbaseTag: null,
  fundingStreams: [{ address: "t3TheStream", valueZat: 12_500_000 }],
  blockRewardZat: 137_724_743,
  totalFeeZat: 20_000,
};

const baseTx: Transaction = {
  txid: "ab".repeat(32),
  blockHeight: block.height,
  blockHash: "0b".repeat(32),
  timestamp: block.timestamp,
  isCoinbase: false,
  version: 5,
  sizeBytes: 1000,
  lockTime: 0,
  expiryHeight: null,
  rawHex: null,
  feeZat: 10_000,
  bindingSigValid: null,
  transparentInputs: [],
  transparentOutputs: [],
  sprout: null,
  sapling: null,
  orchard: null,
  ironwood: null,
};

/** Orchard→Orchard: the case a competitor renders as "Amount 0.0001" — its fee. */
const fullyShielded: Transaction = {
  ...baseTx,
  txid: "cc".repeat(32),
  orchard: { actions: 2, valueBalanceZat: -10_000 },
  ironwood: null,
};

const transparent: Transaction = {
  ...baseTx,
  txid: "dd".repeat(32),
  transparentInputs: [{ address: "t1From", valueZat: 6_709_460_000 }],
  transparentOutputs: [{ address: "t1To", valueZat: 6_709_360_000 }],
};

function renderPage(overrides: Partial<Block> = {}, txs: Transaction[] = []) {
  render(
    <BlockDetailPage
      block={{ ...block, ...overrides }}
      txs={txs}
      tipHeight={block.height}
      oldestHeight={0}
    />,
  );
}

describe("BlockDetailPage transaction values", () => {
  it("veils a fully shielded transaction's value instead of showing its fee", () => {
    renderPage({}, [fullyShielded]);

    expect(screen.getByRole("img", { name: /value shielded/ })).toBeDefined();
    // Its fee is 0.0001 ZEC. Showing that in a value column is the exact mistake.
    expect(screen.queryByText(/0\.0001/)).toBeNull();
    expect(screen.queryByText("—")).toBeNull();
    expect(screen.queryByText(/^0\.00 ZEC$/)).toBeNull();
  });

  it("shows the public value of a transparent transfer, which is genuinely public", () => {
    renderPage({}, [transparent]);
    expect(screen.getByText("67.0936 ZEC")).toBeDefined();
  });

  it("labels a shielded transaction with both its kind and the path value took", () => {
    renderPage({}, [fullyShielded]);

    // TYPE names WHAT happened, DIRECTION names WHERE — one row, two facts. The pool appears
    // on both ends because nothing crossed a boundary, which is the answer, not a fallback.
    expect(screen.getByText("SHIELDED")).toBeDefined();
    expect(screen.getAllByText("orchard")).toHaveLength(2);
    expect(screen.getByRole("img", { name: "moved to" })).toBeDefined();
  });

  it("keeps the two columns from restating one word, on the row where they nearly do", () => {
    /*
     * TYPE and DIRECTION must each carry their own fact. A transparent transfer tests it: the
     * word says what happened, the path says both ends.
     */
    renderPage({}, [transparent]);

    expect(screen.getByText("TRANSPARENT")).toBeDefined();
    // Chips only: the shield's own <title> says "transparent" too, and it is a third channel
    // for the same fact rather than a third statement of it.
    expect(screen.getAllByText("transparent", { selector: "span" })).toHaveLength(2);
    expect(screen.getByRole("img", { name: "moved to" })).toBeDefined();
  });

  it("sources a coinbase from MINED rather than repeating the word beside it", () => {
    renderPage({}, [
      {
        ...baseTx,
        isCoinbase: true,
        feeZat: null,
        transparentOutputs: [{ address: "t1TheMiner", valueZat: 250_000_000 }],
      },
    ]);

    expect(screen.getByText("COINBASE")).toBeDefined();
    expect(screen.getByText("mined")).toBeDefined();
    // One COINBASE on the row: the chip form would be a second copy of the pill's word.
    expect(screen.queryByText("coinbase")).toBeNull();
  });
});

describe("BlockDetailPage reward and miner", () => {
  it("veils a shielded miner rather than calling it unknown", () => {
    renderPage({ miner: { kind: "shielded" } });

    const veil = screen.getByRole("img", { name: /miner shielded/ });
    expect(veil.getAttribute("title")).toContain("hidden by design");
    expect(screen.queryByText("unknown")).toBeNull();
  });

  it("links the miner and the funding stream as separate, labelled rows", () => {
    renderPage();
    expect(screen.getByText("MINER")).toBeDefined();
    expect(screen.getByText("FUNDING STREAMS")).toBeDefined();
    expect(screen.getByRole("link", { name: /t1TheMiner/ }).getAttribute("href")).toBe(
      "/address/t1TheMiner",
    );
    expect(screen.getByRole("link", { name: /t3TheS/ }).getAttribute("href")).toBe(
      "/address/t3TheStream",
    );
  });

  it("says a fee total is unknown rather than showing a short sum as if it were whole", () => {
    renderPage({ totalFeeZat: null });
    expect(screen.getByText("unknown")).toBeDefined();
    expect(screen.queryByText("0.00 ZEC")).toBeNull();
  });

  it("renders the miner's coinbase message as text", () => {
    renderPage({ coinbaseTag: "🦓Mined by milledgeville" });
    expect(screen.getByText(/Mined by milledgeville/)).toBeDefined();
  });
});

describe("named addresses on a block", () => {
  /** #23 of the live rich list. A disbursement address is the one that can plausibly land here. */
  const NAMED = "t3ev37Q2uL1sfTsiJQJiWJoFzQpDhmnUwYo";

  it("names a funding-stream recipient somebody has attributed", () => {
    renderPage({ fundingStreams: [{ address: NAMED, valueZat: 125_000_000 }] });
    const link = screen.getByRole("link", { name: "ZIP-271 Disbursement Multisig" });
    expect(link.getAttribute("href")).toBe(`/address/${NAMED}`);
    expect(link.getAttribute("title")).toBe(NAMED);
  });

  it("names a miner's payout address the same way", () => {
    // Exchanges do not mine, so this is expected to stay theoretical — it costs nothing and
    // the alternative is one render site behaving differently from the other four.
    renderPage({ miner: { kind: "transparent", address: NAMED } });
    expect(screen.getAllByRole("link", { name: "ZIP-271 Disbursement Multisig" }).length).toBe(1);
  });

  it("leaves an unattributed address as an address", () => {
    renderPage({ miner: { kind: "transparent", address: "t1TheMiner" } });
    expect(screen.getByRole("link", { name: /t1TheMiner/ })).toBeDefined();
  });
});
