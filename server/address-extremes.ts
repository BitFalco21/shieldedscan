import type { Pool } from "pg";
import { lifetimeTxCount } from "./address-counts";

/**
 * Per-address value extrema: the most an address ever received or sent in one transaction.
 *
 * Two quantities, kept apart by name. `netChangeZat` is the address's own net movement in a
 * transaction (`addressDeltaZat` in `src/domain/address.ts`, exact arithmetic, the address page's
 * NET column). `publicValueZat` is the whole transaction's transparent value (`publicValueZat` in
 * `src/domain/value.ts`), usually larger. Conflating them would claim an address moved value that
 * merely passed near it.
 *
 * Bounded by construction, because the consumer is public. `io_address_idx` is
 * `(address, block_height DESC)` and carries neither `txid` nor `value_zat`, so grouping an
 * address's history by transaction is one heap fetch per row, and the busiest addresses would take
 * minutes. So the walk reads at most `WINDOW_IO_ROWS` of the newest index entries (a few seconds
 * cold, whatever the address). When the whole history fits, the answer is exact and says so
 * (`complete: true`); when it does not, it covers the most recent transactions and carries the
 * true lifetime count beside it.
 *
 * Not solved with an `(address, txid, value_zat)` index (a large, unpauseable index build that
 * saturates I/O) nor with precomputation (a walk per address for figures rarely asked about).
 *
 * The window is cut on a height boundary, never mid-height: rows arrive newest height first, so
 * on overflow the transactions at the overflow row's height may be partially fetched, and a partial
 * group computes a wrong net change. Every row at or below that height is dropped, so every group
 * is whole (a txid belongs to exactly one block).
 *
 * A NULL `value_zat` (an unresolved input, an OP_RETURN output) contributes nothing, as in
 * `recomputeAddresses`' balance SQL. Coinbase outputs are included, unlike the chain-wide extremes:
 * for an address, a mining payout genuinely is a receipt.
 */

/** About 4 s cold at one heap page per row. See the header. */
export const WINDOW_IO_ROWS = 20_000;

export interface AddressExtremeSide {
  /** The address's own net movement, signed: positive received, negative sent. */
  netChangeZat: number;
  /** How many transactions share that exact net change. Above 1 there is no one to name. */
  count: number;
  /** Named only when `count` is 1 — a tie has no single holder. */
  txid: string | null;
  blockHeight: number | null;
  /**
   * The WHOLE transaction's transparent value (outputs, falling back to inputs), fetched only
   * for a uniquely named transaction. Null on a tie and null when nothing is public.
   */
  publicValueZat: number | null;
}

export interface AddressValueExtremes {
  address: string;
  /**
   * The address's lifetime transaction count, from `lifetimeTxCount` (the reader behind its own
   * `txCount` too). Null only while it cannot be read.
   */
  txCount: number | null;
  /** Distinct transactions the window actually considered. */
  considered: number;
  /** True when the window held the address's entire history, so the figures are all-time. */
  complete: boolean;
  /** Lowest block height the window reached; null when nothing was considered. */
  fromHeight: number | null;
  largestReceived: AddressExtremeSide | null;
  largestSent: AddressExtremeSide | null;
}

interface IoRow {
  txid: string;
  io: "in" | "out";
  value_zat: string | null;
  block_height: number;
}

/** The whole transaction's transparent value — the SQL twin of `publicValueZat` in domain/. */
async function wholeTxPublicValueZat(pool: Pool, txid: string): Promise<number | null> {
  const { rows } = await pool.query<{ v: string | null }>(
    // COALESCE(NULLIF(outputs,0), NULLIF(inputs,0)) is the domain function's own
    // sum-and-fallback, transcribed; the parity test runs both over the same rows.
    `SELECT COALESCE(
              NULLIF(SUM(CASE WHEN io = 'out' THEN value_zat ELSE 0 END), 0),
              NULLIF(SUM(CASE WHEN io = 'in'  THEN value_zat ELSE 0 END), 0)
            )::bigint AS v
       FROM tx_transparent_io
      WHERE txid = $1`,
    [txid],
  );
  const v = rows[0]?.v ?? null;
  return v === null ? null : Number(v);
}

function sideOf(
  groups: Map<string, { net: number; height: number }>,
  pick: "received" | "sent",
): Omit<AddressExtremeSide, "publicValueZat"> | null {
  let best: { net: number; txid: string; height: number } | null = null;
  let count = 0;
  for (const [txid, g] of groups) {
    if (pick === "received" ? g.net <= 0 : g.net >= 0) continue;
    if (best === null || (pick === "received" ? g.net > best.net : g.net < best.net)) {
      best = { net: g.net, txid, height: g.height };
      count = 1;
    } else if (g.net === best.net) {
      count += 1;
    }
  }
  if (best === null) return null;
  return {
    netChangeZat: best.net,
    count,
    txid: count === 1 ? best.txid : null,
    blockHeight: count === 1 ? best.height : null,
  };
}

/** A bounded walk of one address's index rows, newest height first. */
export interface AddressIoWalk {
  rows: IoRow[];
  /** False when the cap bit, so the rows cover only the newest part of the range asked for. */
  complete: boolean;
  /**
   * The lowest height the surviving rows cover, or null when nothing survived. A capped answer
   * publishes this instead of the requested range: the figures describe heights
   * `coversFromHeight`..(the range's top).
   */
  coversFromHeight: number | null;
}

/**
 * Read one address's `tx_transparent_io` rows, newest height first, bounded by row count.
 *
 * Shared by the extrema walk and the windowed activity totals, so the height-boundary rule below
 * has one implementation.
 *
 * `range` narrows to a height span; omitted, it walks the whole history. Either way the predicate
 * is an exact prefix of `io_address_idx` (`(address, block_height DESC)`), so the range is a seek.
 */
export async function walkAddressIo(
  pool: Pool,
  address: string,
  windowRows: number,
  range?: { fromHeight: number; toHeight: number },
): Promise<AddressIoWalk> {
  const bounded = range !== undefined;
  const { rows: fetched } = await pool.query<IoRow>(
    // One heap fetch per row off io_address_idx, so the LIMIT is the cost bound. One extra row
    // makes an overflow detectable.
    `SELECT txid, io, value_zat, block_height
       FROM tx_transparent_io
      WHERE address = $1
        ${bounded ? "AND block_height >= $3 AND block_height <= $4" : ""}
      ORDER BY block_height DESC
      LIMIT $2`,
    bounded
      ? [address, windowRows + 1, range.fromHeight, range.toHeight]
      : [address, windowRows + 1],
  );

  let rows = fetched;
  const complete = rows.length <= windowRows;
  if (!complete) {
    // The overflow row's height may be partially fetched, so every row at or below it is dropped. A
    // txid belongs to exactly one block, so cutting on a height boundary leaves every group whole.
    const boundary = rows[windowRows]!.block_height;
    rows = rows.filter((r) => r.block_height > boundary);
  }
  const last = rows[rows.length - 1];
  return { rows, complete, coversFromHeight: last === undefined ? null : last.block_height };
}

export async function addressValueExtremes(
  pool: Pool,
  address: string,
  // Injectable so the window-boundary behaviour is testable.
  windowRows: number = WINDOW_IO_ROWS,
): Promise<AddressValueExtremes> {
  const [txCount, walk] = await Promise.all([
    lifetimeTxCount(pool, address),
    walkAddressIo(pool, address, windowRows),
  ]);

  const { rows, complete } = walk;

  const groups = new Map<string, { net: number; height: number }>();
  for (const r of rows) {
    const value = r.value_zat === null ? 0 : Number(r.value_zat);
    const delta = r.io === "out" ? value : -value;
    const g = groups.get(r.txid);
    if (g === undefined) groups.set(r.txid, { net: delta, height: r.block_height });
    else g.net += delta;
  }

  const received = sideOf(groups, "received");
  const sent = sideOf(groups, "sent");
  const [receivedValue, sentValue] = await Promise.all([
    received?.txid ? wholeTxPublicValueZat(pool, received.txid) : Promise.resolve(null),
    sent?.txid ? wholeTxPublicValueZat(pool, sent.txid) : Promise.resolve(null),
  ]);

  let fromHeight: number | null = null;
  for (const r of rows)
    if (fromHeight === null || r.block_height < fromHeight) fromHeight = r.block_height;

  return {
    address,
    txCount,
    considered: groups.size,
    complete,
    fromHeight,
    largestReceived: received === null ? null : { ...received, publicValueZat: receivedValue },
    largestSent: sent === null ? null : { ...sent, publicValueZat: sentValue },
  };
}
