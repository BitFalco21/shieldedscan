import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { blockSummaryOf, type BlockMiner, type BlockSummary } from "@/domain";
import { BlocksListPage, blocksPageLabel } from "../BlocksListPage";

const block: BlockSummary = blockSummaryOf({
  height: 2_481_032,
  hash: "b1".repeat(32),
  prevHash: "b0".repeat(32),
  timestamp: 1_783_875_480,
  sizeBytes: 4000,
  txids: ["cb".repeat(32)],
  composition: { transparentTxs: 1, mixedTxs: 0, shieldedTxs: 0 },
  version: 4,
  difficulty: 146_914_688.75,
  bits: "1c00e9e0",
  nonce: "4e".repeat(32),
  merkleRoot: "4d".repeat(32),
  finalSaplingRoot: "5a".repeat(32),
  finalOrchardRoot: "04".repeat(32),
  miner: { kind: "transparent", address: "t1TheMiner" },
  coinbaseTag: null,
  fundingStreams: [],
  blockRewardZat: 312_500_000,
  totalFeeZat: null,
});

function renderBlock(overrides: Partial<BlockSummary>) {
  render(
    <BlocksListPage
      tipHeight={2_481_032}
      dailyUsd={{}}
      priceUsd={null}
      fees24h={null}
      txCount24h={null}
      pageSize={25}
      blocks={[{ ...block, ...overrides }]}
      now={block.timestamp}
      newerHref={null}
      olderHref={null}
      newestHref={null}
      oldestHref={null}
    />,
  );
}

function renderWith(miner: BlockMiner) {
  renderBlock({ miner });
}

describe("BlocksListPage miner column", () => {
  it("links the miner that took the reward", () => {
    renderWith({ kind: "transparent", address: "t1TheMiner" });
    const link = screen.getByRole("link", { name: /t1TheM/ });
    expect(link.getAttribute("href")).toBe("/address/t1TheMiner");
  });

  it("redacts a shielded coinbase instead of leaving the cell empty", () => {
    renderWith({ kind: "shielded" });
    const redaction = screen.getByRole("img", { name: /miner shielded/ });
    expect(redaction.getAttribute("title")).toContain("hidden by design");
    // The Veil rule: never a dash, never a zero, never nothing at all.
    expect(screen.queryByText("—")).toBeNull();
  });

  it("says so plainly when no coinbase output names a payee", () => {
    renderWith({ kind: "unknown" });
    expect(screen.getByText("no payee")).toBeDefined();
  });
});

/**
 * The POOLS column is three bare marks with no text anywhere near them, so what each one
 * means has to arrive on hover or not at all.
 */
describe("BlocksListPage privacy composition", () => {
  it("names the kind and the count on every shield it draws", () => {
    renderBlock({ composition: { transparentTxs: 12, mixedTxs: 1, shieldedTxs: 3 } });
    expect(screen.getByRole("img", { name: "3 fully shielded transactions" })).toBeDefined();
    // Singular, and still carrying the gloss that makes "mixed" legible.
    expect(
      screen.getByRole("img", { name: "1 mixed transaction — partly shielded" }),
    ).toBeDefined();
    expect(screen.getByRole("img", { name: "12 transparent transactions" })).toBeDefined();
  });

  it("draws no shield for a kind the block does not contain", () => {
    // The count is what decides presence, so a zero must not reach the column as "0 …".
    renderBlock({ composition: { transparentTxs: 4, mixedTxs: 0, shieldedTxs: 0 } });
    expect(screen.getByRole("img", { name: "4 transparent transactions" })).toBeDefined();
    expect(screen.queryByRole("img", { name: /shielded/ })).toBeNull();
  });
});

/**
 * The one keyset list with a page ordinal — heights make it arithmetic, not a count.
 */
describe("blocksPageLabel", () => {
  const blockAt = (height: number) => ({ ...block, height, hash: `${height}` });

  it("derives page 1 at the tip", () => {
    expect(blocksPageLabel([blockAt(3_428_195)], 3_428_195, 25)).toBe("page 1 of 137,128");
  });

  it("derives a deep page from how far below the tip it starts", () => {
    // Page 2 starts 25 blocks below the tip.
    expect(blocksPageLabel([blockAt(3_428_170)], 3_428_195, 25)).toBe("page 2 of 137,128");
  });

  it("lands the genesis page on the last ordinal, even short", () => {
    // The oldest page's top is height 20 for a chain of tip 3_428_195 % 25 alignment —
    // whatever its size, its ordinal must equal the total.
    const label = blocksPageLabel([blockAt(20)], 3_428_195, 25);
    expect(label).toBe("page 137,128 of 137,128");
  });

  it("returns nothing for an empty page or a stale tip", () => {
    expect(blocksPageLabel([], 3_428_195, 25)).toBeNull();
    // A cached page fresher than the cached tip must not derive page 0.
    expect(blocksPageLabel([blockAt(3_428_200)], 3_428_195, 25)).toBeNull();
  });
});
