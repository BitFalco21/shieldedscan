import type {
  CrossChainTransfer,
  PulseBlock,
  PulseBlockPools,
  PulseEdgeTotal,
  PulseEvent,
  PulseFrame,
  PulseLedgerRow,
  PulsePendingFrame,
  PulseRibbonsPayload,
  PulseRibbonWindow,
  PulseWindowFrame,
  PoolName,
  Transaction,
  ValuePoolName,
} from "@/domain";
import {
  lockboxLegForBlocks,
  POOL_NAMES,
  pairSwapsWithTxs,
  pulseEventForTransfer,
  pulseEventForTx,
  PULSE_INDEXED_LATE_SECONDS,
} from "@/domain";
import { blocks } from "./blocks";
import { crossChainTransfers } from "./crosschain";
import { mempoolTransactions } from "./mempool";
import { pools } from "./pools";
import { transactions } from "./transactions";
import { TIP_HEIGHT, TIP_TIME, hex64 } from "./ids";

/**
 * The `/pulse` fixtures: the same movements the live path draws, from the same domain
 * functions, over the fixture chain.
 *
 * Nothing here re-derives a direction, an amount or a lockbox delta: every event comes from
 * `pulseEventForTx`, `pulseEventForTransfer` and `lockboxLegForBlocks`, as
 * `server/pulse-routes.ts` builds them, so the fixture chain cannot disagree with the rules.
 *
 * The per-block pool closes are hand-written, since there is no node behind the fixtures.
 * They are walked backwards from the published totals, so the newest block's closes match
 * `/shielded` and each step is exactly what that block's transactions moved.
 */

/** ~1.28 ZEC a block: the NU6 deferred subsidy, so the lockbox leg has something to draw. */
const LOCKBOX_ACCRUAL_ZAT = 128_000_000;
/** How many blocks the live frame carries, matching `PULSE_FRAME_BLOCKS` on the API. */
const FRAME_BLOCKS = 12;
/** How many of an hour's outputs a replay window carries, matching `PULSE_WINDOW_LEDGER_ROWS`. */
const WINDOW_LEDGER_ROWS = 200;

/** How many ledger rows the transparent box lists, matching `PULSE_LEDGER_ROWS`. */
const LEDGER_ROWS = 40;
/** Our follower's own arrival stamp sits a few seconds behind the header on a healthy chain. */
const RECEIVED_LAG_SECONDS = 3;

/**
 * Sprout's public net per transaction, in domain sign — positive means value entered Sprout.
 *
 * A map rather than a field on the fixture transaction, because `SproutBundle` carries a
 * JoinSplit count and no balance: Sprout's public values live on each JoinSplit as
 * `vpub_old`/`vpub_new`. This is that sum, already negated from RPC sign.
 *
 * `750b0dc0…` unshields its transparent output plus the fee.
 */
const SPROUT_NET_ZAT: Record<string, number> = {
  [hex64("750b0dc0")]: -(4_182_718_126_286 + 10_000),
};

const sproutNetOf = (txid: string): number | null => SPROUT_NET_ZAT[txid] ?? null;

const HEIGHTS = blocks.map((b) => b.height).sort((a, b) => a - b);

/**
 * Deliberate holes, each a state the page has to draw that no other fixture expresses. They
 * sit at the older end of the frame: the newest block is what the boxes and the ruler read,
 * and it stays complete.
 */
/** Neither clock recorded an arrival, so the heartbeat draws a gap. */
const NO_ARRIVAL_HEIGHT = TIP_HEIGHT - 8;
/** Stored long after it was mined, so its arrival measures our backfill, not propagation. */
const INDEXED_LATE_HEIGHT = TIP_HEIGHT - 9;
/** A pool the node reported no close for — an outlined box, never a floor-sized one. */
const ABSENT_POOL_HEIGHT = TIP_HEIGHT - 10;
/** A block that produced more movements than one response draws. */
const TRUNCATED_HEIGHT = TIP_HEIGHT - 7;
const TRUNCATED_EVENT_COUNT = 300;

const txsAt = (height: number): Transaction[] =>
  transactions.filter((t) => t.blockHeight === height);

/** What a block's own transactions did to one pool, in domain sign. */
function poolDelta(height: number, pool: ValuePoolName): number {
  const txs = txsAt(height);
  const sum = (values: readonly { valueZat: number }[]): number =>
    values.reduce((total, v) => total + v.valueZat, 0);
  switch (pool) {
    case "transparent":
      // Outputs less inputs over the block's own public sides — arithmetic, never a guess about
      // which output was payment and which was change.
      return txs.reduce((d, t) => d + sum(t.transparentOutputs) - sum(t.transparentInputs), 0);
    case "lockbox":
      return LOCKBOX_ACCRUAL_ZAT;
    case "sprout":
      return txs.reduce((d, t) => d + (sproutNetOf(t.txid) ?? 0), 0);
    case "sapling":
      return txs.reduce((d, t) => d + (t.sapling?.valueBalanceZat ?? 0), 0);
    case "orchard":
      return txs.reduce((d, t) => d + (t.orchard?.valueBalanceZat ?? 0), 0);
    case "ironwood":
      return txs.reduce((d, t) => d + (t.ironwood?.valueBalanceZat ?? 0), 0);
  }
}

const POOL_TOTALS: Record<ValuePoolName, number> = {
  transparent: 1_250_845_176_000_000,
  lockbox: 5_299_350_000_000,
  sprout: pools.find((p) => p.pool === "sprout")?.balanceZat ?? 0,
  sapling: pools.find((p) => p.pool === "sapling")?.balanceZat ?? 0,
  orchard: pools.find((p) => p.pool === "orchard")?.balanceZat ?? 0,
  ironwood: pools.find((p) => p.pool === "ironwood")?.balanceZat ?? 0,
};

/**
 * Every block's closes, walked backwards from the published totals. The tip's row is
 * `getSupplyBreakdown`'s figures, so the boxes agree with `/shielded` and the homepage; each
 * earlier row is the next one less what that block moved.
 */
const CLOSES: Map<number, Record<ValuePoolName, number>> = (() => {
  const out = new Map<number, Record<ValuePoolName, number>>();
  let running = { ...POOL_TOTALS };
  for (let i = HEIGHTS.length - 1; i >= 0; i -= 1) {
    const height = HEIGHTS[i]!;
    out.set(height, { ...running });
    const previous = { ...running };
    for (const pool of Object.keys(previous) as ValuePoolName[]) {
      previous[pool] = previous[pool] - poolDelta(height, pool);
    }
    running = previous;
  }
  return out;
})();

/** The six closes at one height, with the arrival and the absences the page has to draw. */
export function pulseBlockPoolsAt(height: number): PulseBlockPools | null {
  const block = blocks.find((b) => b.height === height);
  const closes = CLOSES.get(height);
  if (block === undefined || closes === undefined) return null;
  const receivedAt =
    height === NO_ARRIVAL_HEIGHT
      ? null
      : block.timestamp +
        (height === INDEXED_LATE_HEIGHT ? PULSE_INDEXED_LATE_SECONDS + 300 : RECEIVED_LAG_SECONDS);
  return {
    height,
    hash: block.hash,
    prevHash: block.prevHash,
    timestamp: block.timestamp,
    receivedAt,
    pools:
      height === ABSENT_POOL_HEIGHT
        ? // Null, never 0: the node reported no close here, and zero would be a measurement.
          { ...closes, sprout: null }
        : closes,
  };
}

/** One block as the page reads it — the same construction `toPulseBlock` uses on the API. */
function pulseBlockAt(height: number): PulseBlock | null {
  const closes = pulseBlockPoolsAt(height);
  if (closes === null) return null;
  const previous = pulseBlockPoolsAt(height - 1);
  const block = blocks.find((b) => b.height === height);
  const events = txsAt(height).map((tx) =>
    pulseEventForTx(tx, sproutNetOf(tx.txid), block?.totalFeeZat ?? null),
  );
  // The lockbox accrual rides with the block's transactions. Absent, never zero, when the two
  // rows do not chain or either close is missing.
  const lockbox = lockboxLegForBlocks(previous, closes);
  const withLockbox = lockbox === null ? events : [...events, lockbox];
  const truncated = height === TRUNCATED_HEIGHT;
  const receivedAt = closes.receivedAt;
  const previousReceived = previous?.receivedAt ?? null;
  return {
    pools: closes,
    events: withLockbox,
    // The count is the fact and the array a window onto it, so a capped block never presents
    // itself as whole.
    eventCount: truncated ? TRUNCATED_EVENT_COUNT : withLockbox.length,
    ...(truncated ? { truncated: true as const } : {}),
    intervalSeconds:
      receivedAt === null || previousReceived === null ? null : receivedAt - previousReceived,
    ...(receivedAt !== null && receivedAt - closes.timestamp > PULSE_INDEXED_LATE_SECONDS
      ? { indexedLate: true as const }
      : {}),
  };
}

/** Completed crossings in a span, as pulses. A refused one (never completed) simply drops. */
function swapEvents(from: number, to: number): PulseEvent[] {
  return crossChainTransfers
    .filter((t: CrossChainTransfer) => t.timestamp >= from && t.timestamp < to)
    .flatMap((t) => {
      const event = pulseEventForTransfer(t);
      return event === null ? [] : [event];
    });
}

/**
 * Folds the crossings into the transactions that carried them, and returns what was left.
 *
 * Keyed on the txid alone, in `pairSwapsWithTxs`. A crossing whose Zcash leg is in this
 * frame becomes part of that transaction's pulse — one movement, one mark — and one whose
 * leg is elsewhere stays its own event, placed at venue time, lighting no box.
 */
function foldSwaps(
  built: PulseBlock[],
  swaps: PulseEvent[],
): { blocks: PulseBlock[]; unpaired: PulseEvent[] } {
  if (swaps.length === 0) return { blocks: built, unpaired: [] };
  const confirmed = built.flatMap((b) => b.events);
  const merged = pairSwapsWithTxs([...confirmed, ...swaps]);
  const byId = new Map(merged.map((e) => [e.id, e]));
  const survivors = new Set(merged.map((e) => e.id));
  return {
    blocks: built.map((block) => ({
      ...block,
      events: block.events.map((event) => byId.get(event.id) ?? event),
    })),
    unpaired: swaps.filter((swap) => survivors.has(swap.id)),
  };
}

/**
 * Real transparent outputs, newest first — never an input→output pairing, never a mempool
 * row. `heights` narrows to one replay hour's blocks, as the store's
 * `listLedgerRowsForHeights` does; without it the rows are the chain's newest.
 */
function ledgerRows(limit: number, heights?: ReadonlySet<number>): PulseLedgerRow[] {
  const rows: PulseLedgerRow[] = [];
  for (const tx of [...transactions].sort((a, b) => b.timestamp - a.timestamp)) {
    if (tx.blockHeight === null || tx.blockHash === null || tx.isCoinbase) continue;
    if (heights !== undefined && !heights.has(tx.blockHeight)) continue;
    for (const output of tx.transparentOutputs) {
      rows.push({
        txid: tx.txid,
        height: tx.blockHeight,
        blockHash: tx.blockHash,
        address: output.address,
        valueZat: output.valueZat,
      });
      if (rows.length >= limit) return rows;
    }
  }
  return rows;
}

export function getPulseFrame(): PulseFrame {
  const drawn = HEIGHTS.slice(-FRAME_BLOCKS)
    .map(pulseBlockAt)
    .filter((b): b is PulseBlock => b !== null);
  const newest = drawn[drawn.length - 1]!;
  const window = {
    fromSeconds: drawn[0]!.pools.timestamp,
    // Half-open: the newest block's own second belongs to this frame.
    toSeconds: newest.pools.timestamp + 1,
  };
  const folded = foldSwaps(drawn, swapEvents(window.fromSeconds, window.toSeconds));
  return {
    window,
    // The node's tip, which may legitimately sit above the newest indexed block.
    tip: TIP_HEIGHT,
    stocks: newest.pools,
    blocks: folded.blocks,
    swaps: folded.unpaired,
    ledger: ledgerRows(LEDGER_ROWS),
  };
}

/**
 * The mempool layer. Every event carries `pending`, set by `pulseEventForTx` from the absent
 * block height, so a pending pulse cannot be mistaken for a confirmed one downstream; its
 * two exits (converted by txid, or faded) are decided on that flag.
 */
export function getPulsePending(): PulsePendingFrame {
  const events = mempoolTransactions.map((tx) => pulseEventForTx(tx, sproutNetOf(tx.txid), null));
  return { asOf: TIP_TIME, count: events.length, events };
}

/** One aligned hour of the fixture chain, echoing the hour that was asked for. */
export function getPulseWindow(fromSeconds: number, toSeconds: number): PulseWindowFrame {
  const inWindow = HEIGHTS.filter((height) => {
    const block = blocks.find((b) => b.height === height);
    return block !== undefined && block.timestamp >= fromSeconds && block.timestamp < toSeconds;
  });
  const built = inWindow.map(pulseBlockAt).filter((b): b is PulseBlock => b !== null);
  const folded = foldSwaps(built, swapEvents(fromSeconds, toSeconds));
  return {
    applied: { fromSeconds, toSeconds },
    blocks: folded.blocks,
    swaps: folded.unpaired,
    ...(folded.blocks.some((b) => b.truncated) ? { truncated: true as const } : {}),
    // This hour's outputs: a replay drawing the chain's newest under a clock set in the past
    // would be a true list making a false claim about when.
    ledger: ledgerRows(WINDOW_LEDGER_ROWS, new Set(inWindow)),
  };
}

const isPoolEnd = (end: string): end is PoolName => (POOL_NAMES as readonly string[]).includes(end);

/**
 * A migration whose destination drew from more than one pool, with the one figure it
 * published.
 *
 * The destination publishes a single `valueBalanceZat` shared by every source, so splitting
 * it between them is the apportioning `poolMigration` refuses. `chain_day_pool_migration`
 * files these under source `'multi'`, and the ribbons exclude them from the edges and report
 * them as `unpaired`. The amount is the destination's own figure — never the sum of the
 * source legs, which includes the fee.
 */
function multiSourceMigrationZat(event: PulseEvent): number | null {
  if (event.kind !== "tx" || event.shape !== "path") return null;
  const destinations = new Set(event.legs.map((l) => l.to));
  const sources = new Set(event.legs.map((l) => l.from));
  if (destinations.size !== 1 || sources.size < 2) return null;
  const destination = [...destinations][0]!;
  if (!isPoolEnd(destination) || ![...sources].every(isPoolEnd)) return null;
  const tx = transactions.find((t) => t.txid === event.id);
  if (tx === undefined) return null;
  const published =
    destination === "sprout" ? sproutNetOf(tx.txid) : (tx[destination]?.valueBalanceZat ?? null);
  return published === null ? null : Math.abs(published);
}

/** Gross flow per edge — two directions between one pair are two rows, never a net. */
function accumulate(events: readonly PulseEvent[]): PulseEdgeTotal[] {
  const totals = new Map<string, PulseEdgeTotal>();
  for (const event of events) {
    // A multi-source migration is not a set of edges: one ribbon per source would state how
    // much came from each, which the chain does not publish.
    if (multiSourceMigrationZat(event) !== null) continue;
    // A hub event's signed legs do not pair, so a ribbon would state a direction the chain did
    // not settle; it is counted in the unpaired totals instead. A ledger movement crosses
    // nothing. A veil's amounts are null and drop out below.
    if (event.shape === "hub" || event.shape === "ledger") continue;
    for (const leg of event.legs) {
      // A `chain:X → hub` leg is kept: a crossing delivered to a `u1…` genuinely ended on the
      // shielded side, and dropping it would leave inbound venue volume out of the totals.
      if (leg.amountZat === null) continue;
      const key = `${leg.from}>${leg.to}`;
      const existing = totals.get(key);
      const isVenue = leg.from.startsWith("chain:") || leg.to.startsWith("chain:");
      totals.set(key, {
        from: leg.from,
        to: leg.to,
        totalZat: (existing?.totalZat ?? 0) + Math.abs(leg.amountZat),
        events: (existing?.events ?? 0) + 1,
        // Sprout's amounts derive from its public JoinSplit values rather than a bundle balance —
        // a different accounting, and the ribbon says so.
        ...(leg.from === "sprout" || leg.to === "sprout" ? { vpubDerived: true as const } : {}),
        // Public swap venues only, so a venue edge is a lower bound however it is summed.
        ...(isVenue ? { floor: true as const } : {}),
      });
    }
  }
  return [...totals.values()].sort((a, b) => b.totalZat - a.totalZat);
}

/**
 * What no ribbon can state: hub legs, which do not pair, and migrations that cannot be
 * apportioned. Reporting these totals keeps the drawn ribbons from silently being the whole
 * story.
 */
function unpairedTotals(events: readonly PulseEvent[]): PulseRibbonWindow["unpaired"] {
  const hubs = events.filter((e) => e.shape === "hub");
  const multi = events.map(multiSourceMigrationZat).filter((zat): zat is number => zat !== null);
  return {
    hubZat: hubs.reduce(
      (total, e) => total + e.legs.reduce((s, l) => s + Math.abs(l.amountZat ?? 0), 0),
      0,
    ),
    hubTxs: hubs.length,
    multiMigrationZat: multi.reduce((total, zat) => total + zat, 0),
    multiMigrationTxs: multi.length,
  };
}

/**
 * The three ribbon windows.
 *
 * The fixture chain is fifty minutes long, so every block falls inside all three windows and
 * summing the whole chain is exact. What makes the windows differ is the venue side: the
 * transfer fixtures span 400 days, so 1Y drops the oldest crossing and 30D drops several
 * more — otherwise the range control would draw the same thing for every option.
 */
const WINDOW_DAYS: Record<"all" | "1y" | "30d", number | null> = {
  all: null,
  "1y": 365,
  "30d": 30,
};

function ribbonWindow(name: "all" | "1y" | "30d"): PulseRibbonWindow {
  const days = WINDOW_DAYS[name];
  const from = days === null ? 0 : TIP_TIME - days * 86_400;
  const confirmed = HEIGHTS.flatMap((height) => pulseBlockAt(height)?.events ?? []);
  const venue = accumulate(swapEvents(from, TIP_TIME + 1));
  return {
    window: { fromSeconds: from, toSeconds: TIP_TIME + 1 },
    edges: [...accumulate(confirmed), ...venue].sort((a, b) => b.totalZat - a.totalZat),
    unpaired: unpairedTotals(confirmed),
  };
}

export function getPulseRibbons(): PulseRibbonsPayload {
  return {
    asOf: TIP_TIME,
    // The height the closes were read at — the row every mined edge is differenced from.
    height: TIP_HEIGHT,
    windows: { all: ribbonWindow("all"), "1y": ribbonWindow("1y"), "30d": ribbonWindow("30d") },
  };
}
