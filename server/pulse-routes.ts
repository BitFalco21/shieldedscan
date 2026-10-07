import { Hono } from "hono";
import type { Pool } from "pg";
import type {
  CrossChainTransfer,
  PulseBlock,
  PulseBlockPools,
  PulseEvent,
  PulseFrame,
  PulseWindow,
  PulseWindowFrame,
} from "@/domain";
import {
  lockboxLegForBlocks,
  pairSwapsWithTxs,
  parsePulseWindowParams,
  pulseEventForTransfer,
  pulseEventForTx,
  PULSE_INDEXED_LATE_SECONDS,
  PULSE_SETTLED_SECONDS,
  PULSE_WINDOW_PARAM_ERROR,
} from "@/domain";
import { Cached } from "./cached";
import "./pg-types";
import type { ChainIndexStore, PulseBlockRow, PulseTxPage } from "./chain-index-store";
import type { NodeChainSource } from "./chain-source";
import { coalesced } from "./coalesce";
import { loadPulseRibbons } from "./pulse-ribbons";
import type { PulseRibbonsPayload } from "@/domain";
import type { PulseMempoolTracker } from "./pulse-mempool";
import type { CrossChainEdgeRow, CrossChainStorePort } from "./crosschain-store";
import { DAY_SECONDS } from "@/domain/time";

/**
 * The four reads behind `/pulse`, split by cadence rather than subject.
 *
 * `/frame` changes when a block arrives; `/pending` every few seconds; `/window` answers a past
 * hour and never changes; `/ribbons` is a day-grained aggregate that moves at most hourly. One
 * endpoint serving all four would make every poll pay for the slowest.
 *
 * All are token-gated with the rest of `/chain/*`, mainnet-only, and need both the index and the
 * node; the page is not offered where any of that is missing.
 */

export const PULSE_FRAME_PATH = "/chain/pulse/frame";
export const PULSE_PENDING_PATH = "/chain/pulse/pending";
export const PULSE_WINDOW_PATH = "/chain/pulse/window";
export const PULSE_RIBBONS_PATH = "/chain/pulse/ribbons";

/** How many blocks the live frame carries: ~15 minutes at the 75-second target. */
export const PULSE_FRAME_BLOCKS = 12;
/** How many ledger rows the transparent box shows. */
export const PULSE_LEDGER_ROWS = 40;
/**
 * How many of an hour's transparent outputs a replay window carries. Larger than the box shows,
 * because a replay reads rows by height: an hour hands over rows from all of its blocks, not only
 * the ones visible at its end. The store spreads the cap across the hour and reports when it bit.
 */
export const PULSE_WINDOW_LEDGER_ROWS = 200;
/** How many unpaired crossings ride along with a frame. */
export const PULSE_FRAME_SWAPS = 20;
/**
 * The per-block drawing cap. Consensus allows a few thousand transactions in a block; past this a
 * block is a slice, and `truncated` says so on the block itself.
 */
export const PULSE_EVENTS_PER_BLOCK = 300;
/**
 * What one request may hydrate, across all its blocks. Shared by the frame and the window: a frame
 * cannot reach it, a replay hour can.
 */
export const PULSE_HYDRATION_CAP = 4_000;
/** How many crossings one replay hour may carry; real hours carry far fewer. */
export const PULSE_WINDOW_SWAPS = 100;
/**
 * How long a past window may be remembered. Only applied to a settled window (see the `/window`
 * route): an hour still within reorg reach is never cached, because the answer can change.
 */
const WINDOW_CACHE_MS = 3_600_000;
const WINDOW_CACHE_KEYS = 48;
/** Well under the block target, so the tip is never more than one block stale. */
const FRAME_TTL_MS = 5_000;
const RIBBONS_TTL_MS = 600_000;

export interface PulseRouteDeps {
  index: ChainIndexStore;
  /** Reads the day matviews for the ribbons. Its own pool, per the convention here. */
  pool: Pool;
  store: CrossChainStorePort;
  source: NodeChainSource;
  /** Absent when the node is not configured: `/pending` then answers 503 rather than empty. */
  mempool: PulseMempoolTracker | null;
  now?: () => number;
}

/**
 * One block as the page reads it.
 *
 * `intervalSeconds` uses one clock (`received_at`, when our follower stored the block) and is null
 * whenever either side recorded no arrival, drawn as a gap. The header timestamp is not a
 * fallback: mixing two clocks yields intervals that are neither, and miner timestamps are only
 * loosely monotonic.
 *
 * `indexedLate` marks a block our follower stored long after it was mined (a catch-up rather than
 * propagation), so the page can place it at header time and say which clock it used.
 */
function toPulseBlock(
  row: PulseBlockRow,
  previous: PulseBlockRow | null,
  page: PulseTxPage,
  events: PulseEvent[],
): PulseBlock {
  const receivedAt = row.pools.receivedAt;
  // The predecessor counts only when it is this block's parent. Blocks reach a window by header
  // timestamp, so a hole in the height set can leave `previous` two blocks back, and subtracting
  // its arrival would present two blocks of propagation as one interval. `lockboxLegForBlocks`
  // applies the same condition to its delta.
  const chained = previous !== null && previous.pools.hash === row.pools.prevHash;
  const previousReceived = chained ? previous.pools.receivedAt : null;
  const eventCount = page.countsByHeight.get(row.pools.height) ?? events.length;
  const lockbox = lockboxLegForBlocks(previous?.pools ?? null, row.pools);
  return {
    pools: row.pools,
    // The lockbox accrual is the block's own movement and rides with its transactions. It is
    // absent, never zero, when the two rows do not chain or either close is missing.
    events: lockbox === null ? events : [...events, lockbox],
    eventCount: lockbox === null ? eventCount : eventCount + 1,
    ...(events.length < eventCount ? { truncated: true as const } : {}),
    intervalSeconds:
      receivedAt === null || previousReceived === null ? null : receivedAt - previousReceived,
    ...(receivedAt !== null && receivedAt - row.pools.timestamp > PULSE_INDEXED_LATE_SECONDS
      ? { indexedLate: true as const }
      : {}),
  };
}

/**
 * Every block's movements, from one hydration page: the transactions arrive as one list for the
 * whole range and are filed by height here, so a frame costs one query, not one per block.
 */
function eventsByHeight(
  page: PulseTxPage,
  blocks: readonly PulseBlockRow[],
): Map<number, PulseEvent[]> {
  const feeByHeight = new Map(blocks.map((b) => [b.pools.height, b.totalFeeZat]));
  const byHeight = new Map<number, PulseEvent[]>();
  for (const { tx, sproutNetZat } of page.rows) {
    if (tx.blockHeight === null) continue;
    // The block's fee total, read only by a coinbase: it collects those fees, so its subsidy is its
    // outputs less them. NULL when the total was not derivable; `pulseEventForTx` then sets
    // `subsidyIncludesFees` rather than invent a split.
    const blockFee = feeByHeight.get(tx.blockHeight) ?? null;
    const list = byHeight.get(tx.blockHeight) ?? [];
    list.push(pulseEventForTx(tx, sproutNetZat, blockFee));
    byHeight.set(tx.blockHeight, list);
  }
  return byHeight;
}

/**
 * Folds the crossings into the transactions that carried them, and returns what was left over.
 *
 * Pairing is `pairSwapsWithTxs`' job and keys on the txid alone. A crossing whose Zcash leg is in
 * this frame becomes part of that transaction's pulse (one movement, one mark); one whose leg is
 * elsewhere stays its own event, placed at venue time, lighting no box.
 */
function foldSwaps(
  blocks: PulseBlock[],
  swaps: readonly PulseEvent[],
): { blocks: PulseBlock[]; unpaired: PulseEvent[] } {
  if (swaps.length === 0) return { blocks, unpaired: [] };
  const confirmed = blocks.flatMap((b) => b.events);
  const merged = pairSwapsWithTxs([...confirmed, ...swaps]);
  const byId = new Map(merged.map((e) => [e.id, e]));
  const survivors = new Set(merged.map((e) => e.id));
  return {
    blocks: blocks.map((block) => ({
      ...block,
      events: block.events.map((event) => byId.get(event.id) ?? event),
    })),
    unpaired: swaps.filter((swap) => survivors.has(swap.id)),
  };
}

/** Completed crossings in a span, as pulses. A refused one (never completed) simply drops. */
function swapEvents(transfers: readonly CrossChainTransfer[]): PulseEvent[] {
  return transfers.flatMap((t) => {
    const event = pulseEventForTransfer(t);
    return event === null ? [] : [event];
  });
}

export function pulseRoutes(deps: PulseRouteDeps): Hono {
  const app = new Hono();
  const now = deps.now ?? Date.now;
  const nowSeconds = (): number => Math.floor(now() / 1000);

  /**
   * Keyed on the tip, so a new block invalidates the entry as soon as the node has it, and the TTL
   * only removes repeat cost between blocks. Single-flight, as for `/chain/blocks`.
   */
  const frame = coalesced<PulseFrame | null>(FRAME_TTL_MS);
  const ribbons = new Cached<PulseRibbonsPayload | null>(RIBBONS_TTL_MS);
  /**
   * Settled hours only, bounded: a replay walks 24 of them and a reader may scrub back and forth.
   * An hour within reorg reach is never stored, because a cached answer could state a block that no
   * longer exists.
   */
  const windows = new Map<string, { at: number; value: PulseWindowFrame }>();

  const buildBlocks = async (
    rows: readonly PulseBlockRow[],
    previousToFirst: PulseBlockRow | null,
    caps: { perBlock: number; total: number },
  ): Promise<PulseBlock[]> => {
    if (rows.length === 0) return [];
    const page = await deps.index.listTransactionsForHeights(
      rows.map((r) => r.pools.height),
      caps,
    );
    const events = eventsByHeight(page, rows);
    return rows.map((row, i) =>
      toPulseBlock(
        row,
        i === 0 ? previousToFirst : (rows[i - 1] ?? null),
        page,
        events.get(row.pools.height) ?? [],
      ),
    );
  };

  app.get(PULSE_FRAME_PATH, async (c) => {
    const tip = await deps.source.getTipHeight();
    const built = await frame(String(tip), async () => {
      // One extra block, used only as the predecessor of the oldest one drawn: without it the first
      // block of every frame would lose its interval and its lockbox delta.
      const rows = await deps.index.listPulseBlocks({ latest: PULSE_FRAME_BLOCKS + 1 });
      const drawn = rows.length > PULSE_FRAME_BLOCKS ? rows.slice(1) : rows;
      const previous = rows.length > PULSE_FRAME_BLOCKS ? (rows[0] ?? null) : null;
      const newest = drawn[drawn.length - 1];
      // No blocks in the index at all: a 503 rather than an empty frame, since empty boxes would
      // state that the pools hold nothing.
      if (newest === undefined) return null;

      const window: PulseWindow = {
        fromSeconds: drawn[0]!.pools.timestamp,
        // Half-open: the newest block's own second belongs to this frame, so the end is one second
        // past it.
        toSeconds: newest.pools.timestamp + 1,
      };
      const [blocks, ledger, transfers] = await Promise.all([
        buildBlocks(drawn, previous, {
          perBlock: PULSE_EVENTS_PER_BLOCK,
          total: PULSE_HYDRATION_CAP,
        }),
        deps.index.listLedgerRows(PULSE_LEDGER_ROWS),
        // Narrowed to the frame's own span: an unpaired crossing is placed at venue time, and the
        // blocks bound the span.
        deps.store.list(
          { limit: PULSE_FRAME_SWAPS },
          { fromTimestamp: window.fromSeconds, toTimestamp: window.toSeconds },
        ),
      ]);
      const folded = foldSwaps(blocks, swapEvents(transfers.items));
      return {
        window,
        tip,
        stocks: newest.pools satisfies PulseBlockPools,
        blocks: folded.blocks,
        swaps: folded.unpaired,
        // The crossings' cap is reported when it bit, measured on what the store returned rather
        // than on `folded.unpaired` (pairing legitimately removes crossings from that array).
        ...(transfers.items.length >= PULSE_FRAME_SWAPS ? { swapsTruncated: true as const } : {}),
        ledger,
      };
    });
    if (built === null) return c.json({ error: "the chain index holds no blocks yet" }, 503);
    return c.json(built);
  });

  app.get(PULSE_PENDING_PATH, (c) => {
    const snapshot = deps.mempool?.snapshot() ?? null;
    // A cold tracker contributes NULL, never `{count: 0}`, which would be a measurement.
    if (snapshot === null) return c.json({ error: "the mempool has not been read yet" }, 503);
    c.header("Cache-Control", "no-store");
    return c.json(snapshot);
  });

  app.get(PULSE_WINDOW_PATH, async (c) => {
    // `@/domain`'s parser, shared with the Next route in front of this one, so both refuse exactly
    // the same malformed hours.
    const applied = parsePulseWindowParams(c.req.query("from"), c.req.query("to"), nowSeconds());
    if (applied === null) {
      return c.json({ error: PULSE_WINDOW_PARAM_ERROR }, 400);
    }
    // Settled against the chain's own clock rather than the wall clock: an hour is safe to remember
    // once the tip has moved past reorg reach of it, and on a follower that is behind, the wall
    // clock would call an hour old before the index has reached it. One indexed
    // `ORDER BY height DESC LIMIT 1`. The settled distance, `PULSE_SETTLED_SECONDS`, is shared with
    // the Next route.
    const [newest] = await deps.index.listPulseBlocks({ latest: 1 });
    const tipTimestamp = newest?.pools.timestamp ?? 0;
    const settled = applied.toSeconds < tipTimestamp - PULSE_SETTLED_SECONDS;
    const key = String(applied.fromSeconds);
    const hit = windows.get(key);
    if (settled && hit && now() - hit.at < WINDOW_CACHE_MS) return c.json(hit.value);

    const rows = await deps.index.listPulseBlocks({
      fromSeconds: applied.fromSeconds,
      toSeconds: applied.toSeconds,
    });
    const first = rows[0];
    // The block before the window, for the first block's interval and lockbox delta. Fetched rather
    // than folded into the range, so the window stays exactly half-open.
    const previous =
      first === undefined ? null : ((await deps.index.blockAt(first.pools.height - 1)) ?? null);
    const blocks = await buildBlocks(rows, previous, {
      perBlock: PULSE_EVENTS_PER_BLOCK,
      total: PULSE_HYDRATION_CAP,
    });
    const [transfers, ledger] = await Promise.all([
      deps.store.list(
        { limit: PULSE_WINDOW_SWAPS },
        { fromTimestamp: applied.fromSeconds, toTimestamp: applied.toSeconds },
      ),
      // This hour's outputs, not the chain's newest: drawing the newest under a clock set in the
      // past would misstate when they happened.
      deps.index.listLedgerRowsForHeights(
        rows.map((r) => r.pools.height),
        PULSE_WINDOW_LEDGER_ROWS,
      ),
    ]);
    const folded = foldSwaps(blocks, swapEvents(transfers.items));
    const payload: PulseWindowFrame = {
      applied,
      blocks: folded.blocks,
      swaps: folded.unpaired,
      ledger: ledger.rows,
      // Exact: the read asks for one row more than it carries, so this means the hour holds more
      // outputs than are here.
      ...(ledger.truncated ? { ledgerTruncated: true as const } : {}),
      // Either kind of slice: a block whose events were capped, or an hour holding more crossings
      // than one response carries. Which block is capped is marked on the block itself.
      ...(folded.blocks.some((b) => b.truncated) || transfers.items.length >= PULSE_WINDOW_SWAPS
        ? { truncated: true as const }
        : {}),
    };
    if (settled) {
      windows.set(key, { at: now(), value: payload });
      // Bounded: a replay can ask for any hour of history, and this must not become a leak.
      while (windows.size > WINDOW_CACHE_KEYS) {
        const oldest = windows.keys().next().value;
        if (oldest === undefined) break;
        windows.delete(oldest);
      }
    }
    return c.json(payload);
  });

  app.get(PULSE_RIBBONS_PATH, async (c) => {
    const built = await ribbons.get(async () => {
      const at = now();
      const seconds = Math.floor(at / 1000);
      // One read per window, because each window is a different question; the venue rows are the
      // only part of a ribbon not already day-grained.
      const edges: Record<"all" | "1y" | "30d", CrossChainEdgeRow[]> = {
        all: await deps.store.crossChainEdges(null),
        "1y": await deps.store.crossChainEdges(seconds - 365 * DAY_SECONDS),
        "30d": await deps.store.crossChainEdges(seconds - 30 * DAY_SECONDS),
      };
      return loadPulseRibbons(deps.pool, edges, at);
    });
    // 503 while a matview has not been populated: `edges: []` would state that nothing has ever
    // crossed the boundary. Not cached, so the refusal ends as soon as `npm run
    // fill:pool-analytics` finishes.
    if (built === null) {
      ribbons.clear();
      return c.json({ error: "the pool day views have not been populated yet" }, 503);
    }
    return c.json(built);
  });

  return app;
}
