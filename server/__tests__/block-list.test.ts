import { describe, expect, it, vi } from "vitest";
import { blockSummaryOf, type Block, type BlockSummary } from "@/domain";
import { decodeCursor, encodeCursor, ORIGIN_CURSOR } from "@/data/cursor";
import { blocks as fixtureBlocks } from "@/fixtures/blocks";
import {
  blockRowsReader,
  listBlockRows,
  readBlockListTips,
  type BlockListNode,
  type BlockListSources,
} from "../block-list";

/**
 * The block list both `/chain/blocks` and `/v1/blocks` serve: rows from the chain index, the node
 * topping up what the follower has not stored yet, and the node answering whole whenever the
 * index cannot state a page or the two disagree about the chain.
 *
 * A page must read the same whichever source answered it; the node-only list is the reference.
 */

const template = fixtureBlocks[0]!;
const hashAt = (h: number, fork = "") => `${fork}${h}`.padStart(64, "0");

/** A dense chain 0..tip, each block's parent the one below it. */
function chainTo(tip: number, fork: { from: number; tag: string } | null = null): Block[] {
  return Array.from({ length: tip + 1 }, (_, h) => {
    const tag = fork && h >= fork.from ? fork.tag : "";
    const parentTag = fork && h - 1 >= fork.from ? fork.tag : "";
    return {
      ...template,
      height: h,
      hash: hashAt(h, tag),
      prevHash: h === 0 ? null : hashAt(h - 1, parentTag),
      txids: [`cb${h}`],
      totalFeeZat: null,
    } as Block;
  });
}

function node(chain: Block[], over: Partial<BlockListNode> = {}) {
  const tip = chain[chain.length - 1]!;
  const blocksDescending = vi.fn(async (top: number, count: number) => {
    const out: Block[] = [];
    for (let h = top; h > top - count && h >= 0; h -= 1) {
      const b = chain[h];
      if (b) out.push(b);
    }
    return out;
  });
  return {
    getTip: vi.fn(async () => ({ height: tip.height, hash: tip.hash })),
    blocksDescending,
    ...over,
  };
}

/** The index: the chain as the follower stored it, each block with a fee the follower derived. */
function index(stored: Block[]) {
  const rows = new Map<number, BlockSummary>(
    stored.map((b) => [b.height, { ...blockSummaryOf(b), totalFeeZat: 1_000 + b.height }]),
  );
  const unstatable = new Set<number>();
  return {
    unstatable,
    tipHeight: vi.fn(async () => (stored.length ? stored[stored.length - 1]!.height : null)),
    blockSummaries: vi.fn(async (lo: number, hi: number) => {
      const out: BlockSummary[] = [];
      for (let h = hi; h >= lo; h -= 1) {
        const r = rows.get(h);
        if (!r || unstatable.has(h)) return null;
        out.push(r);
      }
      return out;
    }),
    blockFees: vi.fn(
      async (heights: readonly number[]) =>
        new Map(heights.map((h) => [h, rows.get(h)?.totalFeeZat ?? null])),
    ),
  };
}

const list = async (sources: BlockListSources, q: Parameters<typeof listBlockRows>[1]) =>
  listBlockRows(sources, q, await readBlockListTips(sources));
const heights = (rows: readonly { height: number }[]) => rows.map((r) => r.height);
const withoutFees = (rows: readonly BlockSummary[]) =>
  rows.map((r) => ({ ...r, totalFeeZat: null }));

describe("listBlockRows", () => {
  it("serves a page the index holds from the index alone", async () => {
    const chain = chainTo(60);
    const n = node(chain);
    const i = index(chain);
    const page = await list({ node: n, index: i }, { limit: 5 });

    expect(heights(page.items)).toEqual([60, 59, 58, 57, 56]);
    expect(n.blocksDescending).not.toHaveBeenCalled();
    // The index's fees ride on the rows: the node's list never resolved one.
    expect(page.items[0]!.totalFeeZat).toBe(1_060);
    expect(page.feesStated).toBe(true);
  });

  it("tops the head page up from the node with what the follower has not stored yet", async () => {
    // The seconds between the node accepting a block and the follower writing it: the list must
    // still show the newest block.
    const chain = chainTo(60);
    const n = node(chain);
    const page = await list({ node: n, index: index(chain.slice(0, 59)) }, { limit: 5 });

    expect(heights(page.items)).toEqual([60, 59, 58, 57, 56]);
    expect(n.blocksDescending).toHaveBeenCalledExactlyOnceWith(60, 2);
    // A block the follower has not reached has no derived fee yet; the rest keep theirs.
    expect(page.items.map((r) => r.totalFeeZat)).toEqual([null, null, 1_058, 1_057, 1_056]);
    expect(page.prevCursor).toBeNull();
  });

  it("pages exactly as the node-only list pages, for every cursor", async () => {
    const chain = chainTo(60);
    const both = { node: node(chain), index: index(chain.slice(0, 59)) };
    const nodeOnly = { node: node(chain) };
    const walk = async (sources: BlockListSources) => {
      const pages = [await list(sources, { limit: 7 })];
      while (pages[pages.length - 1]!.nextCursor) {
        pages.push(await list(sources, { limit: 7, before: pages[pages.length - 1]!.nextCursor! }));
      }
      const back = await list(sources, { limit: 7, after: pages[3]!.prevCursor! });
      const oldest = await list(sources, { limit: 7, after: ORIGIN_CURSOR });
      return { pages, back, oldest };
    };
    const a = await walk(both);
    const b = await walk(nodeOnly);

    expect(a.pages.map((p) => withoutFees(p.items))).toEqual(b.pages.map((p) => p.items));
    expect(a.pages.map((p) => [p.nextCursor, p.prevCursor])).toEqual(
      b.pages.map((p) => [p.nextCursor, p.prevCursor]),
    );
    // No height twice and none skipped, 60 down to genesis.
    expect(a.pages.flatMap((p) => heights(p.items))).toEqual(
      Array.from({ length: 61 }, (_, k) => 60 - k),
    );
    expect(withoutFees(a.back.items)).toEqual(b.back.items);
    expect(heights(a.oldest.items)).toEqual([6, 5, 4, 3, 2, 1, 0]);
    expect(a.oldest.nextCursor).toBeNull();
    expect(decodeCursor(a.back.prevCursor!)?.sortKey).toBe(String(a.back.items[0]!.height));
  });

  it("asks the node for the whole page when one row cannot be stated, fees from the index", async () => {
    const chain = chainTo(60);
    const n = node(chain);
    const i = index(chain);
    i.unstatable.add(58);
    const page = await list({ node: n, index: i }, { limit: 5 });

    expect(heights(page.items)).toEqual([60, 59, 58, 57, 56]);
    expect(n.blocksDescending).toHaveBeenCalledExactlyOnceWith(60, 5);
    expect(page.items[2]!.totalFeeZat).toBe(1_058);
  });

  it("never shows an orphan the follower has not rolled back as the newest block", async () => {
    // A depth-1 reorg at the tip: the node replaced 60, the index still holds the old 60.
    const stored = chainTo(60);
    const live = chainTo(60, { from: 60, tag: "f" });
    const n = node(live);
    const page = await list({ node: n, index: index(stored) }, { limit: 5 });

    expect(page.items[0]!.hash).toBe(live[60]!.hash);
    expect(n.blocksDescending).toHaveBeenCalledExactlyOnceWith(60, 5);
  });

  it("asks the node when the block it tops up with does not extend the index's tip", async () => {
    // The node is one block ahead on a branch that replaced the index's tip: 60 on the index is
    // an orphan, and 61 on the node is not its child.
    const stored = chainTo(60);
    const live = chainTo(61, { from: 60, tag: "f" });
    const n = node(live);
    const page = await list({ node: n, index: index(stored) }, { limit: 5 });

    expect(page.items.map((r) => r.hash)).toEqual([61, 60, 59, 58, 57].map((h) => live[h]!.hash));
  });

  it("pages from the index alone when the node cannot be asked", async () => {
    // A node restart: the list keeps working, against the index's own tip.
    const chain = chainTo(60);
    const n = node(chain, { getTip: vi.fn(async () => Promise.reject(new Error("node down"))) });
    const page = await list({ node: n, index: index(chain.slice(0, 59)) }, { limit: 5 });

    expect(heights(page.items)).toEqual([58, 57, 56, 55, 54]);
    expect(page.prevCursor).toBeNull();
    expect(n.blocksDescending).not.toHaveBeenCalled();
  });

  it("rejects when nothing can answer, rather than serving an empty chain", async () => {
    const n = node(chainTo(5), {
      getTip: vi.fn(async () => Promise.reject(new Error("node down"))),
    });
    await expect(list({ node: n }, { limit: 5 })).rejects.toThrow(/node down/);
    await expect(list({ node: n, index: index([]) }, { limit: 5 })).rejects.toThrow(/node down/);
  });

  it("serves the node's rows with no index, and says no fee was looked up", async () => {
    const page = await list({ node: node(chainTo(10)) }, { limit: 3 });

    expect(heights(page.items)).toEqual([10, 9, 8]);
    expect(page.feesStated).toBe(false);
    expect(page.items.every((r) => r.totalFeeZat === null)).toBe(true);
  });
});

describe("blockRowsReader", () => {
  it("shares one read between concurrent readers, and re-reads when the index advances", async () => {
    const chain = chainTo(60);
    const stored = chain.slice(0, 60);
    const i = index(stored);
    const read = blockRowsReader({ node: node(chain), index: i });
    await Promise.all([read({ limit: 5 }), read({ limit: 5 }), read({ limit: 5 })]);
    expect(i.blockSummaries).toHaveBeenCalledTimes(1);

    // The follower stores 60: same node tip, a new index tip, so the next read is fresh and the
    // block now carries the fee the follower derived.
    i.tipHeight.mockResolvedValue(60);
    i.blockSummaries.mockImplementation(async (lo: number, hi: number) =>
      chain
        .slice(lo, hi + 1)
        .reverse()
        .map((b) => ({ ...blockSummaryOf(b), totalFeeZat: 1_000 + b.height })),
    );
    const page = await read({ limit: 5 });
    expect(page.items[0]!.totalFeeZat).toBe(1_060);
  });

  it("keys each page apart", async () => {
    const chain = chainTo(60);
    const read = blockRowsReader({ node: node(chain), index: index(chain) });
    const first = await read({ limit: 5 });
    const second = await read({ limit: 5, before: first.nextCursor! });
    expect(heights(second.items)).toEqual([55, 54, 53, 52, 51]);
    const cursorFor = (h: number) => encodeCursor(h, String(h));
    expect(heights((await read({ limit: 5, before: cursorFor(10) })).items)).toEqual([
      9, 8, 7, 6, 5,
    ]);
  });
});
