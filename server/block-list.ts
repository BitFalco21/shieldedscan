import { blockSummaryOf, type Block, type BlockSummary } from "@/domain";
import { decodeCursorForColumn, encodeCursor, INT4_SORT_KEY_MAX } from "@/data/cursor";
import type { CursorPage, CursorQuery } from "@/data/source";
import { coalesced } from "./coalesce";
import { clampPageSize } from "./page-size";

/**
 * The block list (`/chain/blocks` for the site, `/v1/blocks` for the public API) in one
 * implementation, so the two can never page or state a row differently.
 *
 * Rows come from the chain index wherever it holds them: a page is a few queries there, where the
 * node needs one `getblock` per row, which does not hold up under concurrent load. The node still
 * supplies what the index has not stored yet (the newest block or two, before the follower writes
 * them), so a new block reaches the list as soon as the node has it. The node answers a whole page
 * whenever the index cannot state one exactly, or the two disagree about which chain they hold.
 *
 * Paged against the node's tip: height is the unique sort key, `before` seeks down, `after` seeks
 * up (the oldest page is `after` the origin), and a page is at most `limit` rows. A client cannot
 * tell which source answered a row, except that a row the index has not stored yet has no fee.
 */

/** What the list needs from the node. */
export interface BlockListNode {
  /** The tip's height and hash from one read. */
  getTip(): Promise<{ height: number; hash: string }>;
  /** Blocks `top` down to `top - count + 1` (never below 0), newest first; a missing one is absent. */
  blocksDescending(top: number, count: number): Promise<Block[]>;
}

/** What the list needs from the chain index — `ChainIndexStore`. */
export interface BlockListIndex {
  /** The newest stored block, or null for an empty index. */
  tipHeight(): Promise<number | null>;
  /** List rows for heights `hi` down to `lo`, or null when any one cannot be stated exactly. */
  blockSummaries(lo: number, hi: number): Promise<BlockSummary[] | null>;
  blockFees(heights: readonly number[]): Promise<Map<number, number | null>>;
}

export interface BlockListSources {
  node?: BlockListNode;
  index?: BlockListIndex;
}

/** Both tips, read before the page so a cache key can carry them. */
export interface BlockListTips {
  /** Null when the node could not answer and the index pages alone. */
  node: { height: number; hash: string } | null;
  /** Null without an index, or with an empty one. */
  index: number | null;
}

export interface BlockRowsPage extends CursorPage<BlockSummary> {
  /**
   * Whether this page's fees were read from the index. False only when the node answered with no
   * index to ask: every fee is then null because nothing looked it up, which `/v1` states as
   * `omitted`, never as a figure it could not derive.
   */
  feesStated: boolean;
}

export type BlockRowsReader = (query: CursorQuery) => Promise<BlockRowsPage>;

/** A cursor's height, range-checked as every keyset here checks one; null means the first page. */
function cursorHeight(raw: string | undefined): number | null {
  const cursor = raw ? decodeCursorForColumn(raw, INT4_SORT_KEY_MAX) : null;
  return cursor === null ? null : Number(cursor.sortKey);
}

/** Each row's parent is the row below it. */
function isOneChain(rows: readonly BlockSummary[]): boolean {
  for (let i = 0; i + 1 < rows.length; i += 1) {
    if (rows[i]!.prevHash !== rows[i + 1]!.hash) return false;
  }
  return true;
}

/**
 * Both tips. A node that cannot answer leaves the index to page alone, which keeps the public list
 * working through a node restart. With no index to fall back on, the node's error is the answer.
 */
export async function readBlockListTips(sources: BlockListSources): Promise<BlockListTips> {
  let nodeError: unknown = null;
  const [node, index] = await Promise.all([
    sources.node
      ? sources.node.getTip().catch((error: unknown) => {
          nodeError = error;
          return null;
        })
      : null,
    sources.index ? sources.index.tipHeight() : null,
  ]);
  if (node === null && index === null) throw nodeError ?? new Error("no block source answered");
  return { node, index };
}

/** The page whose rows the index cannot state, or which the follower has not reached, whole from the node. */
async function fromNode(
  sources: BlockListSources,
  indexUp: boolean,
  lo: number,
  top: number,
): Promise<BlockSummary[]> {
  if (!sources.node) throw new Error("the chain index cannot state this page and there is no node");
  const blocks = await sources.node.blocksDescending(top, top - lo + 1);
  if (!sources.index || !indexUp || blocks.length === 0) return blocks.map(blockSummaryOf);
  // The node never resolves inputs for a list; the index has each block's fee in one read.
  const fees = await sources.index.blockFees(blocks.map((b) => b.height));
  return blocks.map((b) => ({ ...blockSummaryOf(b), totalFeeZat: fees.get(b.height) ?? null }));
}

/** The page from the index, topped up from the node above the index's tip; null to ask the node. */
async function fromIndex(
  sources: BlockListSources & { index: BlockListIndex },
  tips: BlockListTips & { index: number },
  lo: number,
  top: number,
): Promise<BlockSummary[] | null> {
  const storedTop = Math.min(top, tips.index);
  // Nothing on this page is stored yet (a follower far behind): ask the node.
  if (storedTop < lo) return null;
  const unstored = top - storedTop;
  if (unstored > 0 && !sources.node) return null;
  const [stored, fresh] = await Promise.all([
    sources.index.blockSummaries(lo, storedTop),
    unstored > 0 ? sources.node!.blocksDescending(top, unstored) : Promise.resolve<Block[]>([]),
  ]);
  if (stored === null || fresh.length !== unstored) return null;
  // `blockSummaryOf` of a node block carries a null fee: the follower has not derived it yet.
  const rows = [...fresh.map(blockSummaryOf), ...stored];
  // One chain, and the node's chain where the page reaches its tip. Anything else is a reorg the
  // follower has not rolled back yet, and an orphan must never appear as the newest block.
  if (!isOneChain(rows)) return null;
  const head = rows[0];
  if (tips.node && head && head.height === tips.node.height && head.hash !== tips.node.hash) {
    return null;
  }
  return rows;
}

export async function listBlockRows(
  sources: BlockListSources,
  query: CursorQuery,
  tips: BlockListTips,
): Promise<BlockRowsPage> {
  const tip = tips.node?.height ?? tips.index;
  if (tip === null) throw new Error("no block source answered");
  const indexUp = sources.index !== undefined && tips.index !== null;
  const limit = clampPageSize(query.limit);
  const before = cursorHeight(query.before);
  const after = cursorHeight(query.after);
  const top = Math.min(tip, before !== null ? before - 1 : after !== null ? after + limit : tip);
  if (top < 0) return { items: [], nextCursor: null, prevCursor: null, feesStated: indexUp };
  const lo = Math.max(0, top - limit + 1);

  const indexed =
    indexUp && sources.index
      ? await fromIndex(
          { ...sources, index: sources.index },
          { ...tips, index: tips.index! },
          lo,
          top,
        )
      : null;
  const rows = indexed ?? (await fromNode(sources, indexUp, lo, top));
  const last = rows[rows.length - 1];
  const first = rows[0];
  return {
    items: rows,
    nextCursor: last && last.height > 0 ? encodeCursor(last.height, String(last.height)) : null,
    prevCursor:
      first && first.height < tip ? encodeCursor(first.height, String(first.height)) : null,
    feesStated: indexUp,
  };
}

/**
 * The list behind a single-flight cache, keyed on both tips and the page: concurrent readers of
 * one page share one read, a block reaching the node or the index changes the key at once, and the
 * TTL bounds what an idle tip costs. The cache in `coalesce.ts` exists for this list.
 */
export function blockRowsReader(sources: BlockListSources, ttlMs = 20_000): BlockRowsReader {
  const cache = coalesced<BlockRowsPage>(ttlMs);
  return async (query) => {
    const tips = await readBlockListTips(sources);
    const key = [
      tips.node?.height ?? "",
      tips.node?.hash ?? "",
      tips.index ?? "",
      query.before ?? "",
      query.after ?? "",
      clampPageSize(query.limit),
    ].join("|");
    return cache(key, () => listBlockRows(sources, query, tips));
  };
}
