import type { Pool } from "pg";
import { lifetimeTxCount } from "./address-counts";
import { WINDOW_IO_ROWS, walkAddressIo } from "./address-extremes";
import { blockHeightRange } from "./chain-window";

/**
 * What one address did over a period: how many transactions, how much in, how much out.
 *
 * Received minus sent is `addressDeltaZat` over a range (outputs paying the address minus inputs
 * spending from it), which is exact arithmetic. Deciding which output was a payment and which was
 * change, or naming a counterparty, is not done here or anywhere.
 *
 * Shielded value is absent by construction: a shielded transaction has no address to file under,
 * so a transparent address's window covers its transparent activity only, and consumers must not
 * present it as the address's whole activity.
 *
 * Bounded like `addressValueExtremes`: the index carries neither `txid` nor `value_zat`, so
 * grouping by transaction is one heap fetch per row, and the busiest addresses hold hundreds of
 * thousands of rows. The walk reads at most `WINDOW_IO_ROWS` of the newest rows in the range, and
 * when that bites the answer states which heights it actually covers.
 */

export interface AddressActivityWindow {
  address: string;
  /**
   * The height range the requested days resolved to, or null when the window covers no block.
   * Published because timestamps are miner-supplied, so this mapping is the one step a reader
   * cannot verify from the totals; either height can be opened on the site.
   */
  fromHeight: number | null;
  toHeight: number | null;
  /** Distinct transactions in the range that paid this address or spent from it. */
  txCount: number;
  /** Transparent value paid TO the address, in zatoshis. Never includes shielded value. */
  receivedZat: number;
  /** Transparent value spent FROM the address, in zatoshis. */
  sentZat: number;
  /** `receivedZat - sentZat`: exact arithmetic over the range. */
  netZat: number;
  /** Lowest and highest height in the range this address actually appears at. */
  firstHeight: number | null;
  lastHeight: number | null;
  /** False when the row cap bit, so the figures cover only `coversFromHeight` upward. */
  complete: boolean;
  coversFromHeight: number | null;
  /**
   * The address's lifetime transaction count, from `lifetimeTxCount` (the same reader as the
   * address's own `txCount`, so they agree). Beside a windowed or capped count it is the
   * denominator that stops a partial figure reading as the whole. Null only while it cannot be
   * read.
   */
  lifetimeTxCount: number | null;
}

/**
 * The window's height range via `blockHeightRange`, or null when no block falls in it: a period
 * the chain did not reach is a measurement, not a failure.
 */
async function heightRange(
  pool: Pool,
  fromTimestamp: number,
  toTimestamp: number,
): Promise<{ fromHeight: number; toHeight: number } | null> {
  const { lo, hi } = await blockHeightRange(pool, fromTimestamp, toTimestamp);
  return lo === null || hi === null ? null : { fromHeight: lo, toHeight: hi };
}

export async function addressActivityWindow(
  pool: Pool,
  address: string,
  fromTimestamp: number,
  toTimestamp: number,
  // Injectable so the cap's behaviour is testable.
  windowRows: number = WINDOW_IO_ROWS,
): Promise<AddressActivityWindow> {
  const [range, lifetime] = await Promise.all([
    heightRange(pool, fromTimestamp, toTimestamp),
    lifetimeTxCount(pool, address),
  ]);

  const empty: AddressActivityWindow = {
    address,
    fromHeight: range?.fromHeight ?? null,
    toHeight: range?.toHeight ?? null,
    txCount: 0,
    receivedZat: 0,
    sentZat: 0,
    netZat: 0,
    firstHeight: null,
    lastHeight: null,
    complete: true,
    coversFromHeight: null,
    lifetimeTxCount: lifetime,
  };
  if (range === null) return empty;

  const walk = await walkAddressIo(pool, address, windowRows, range);
  if (walk.rows.length === 0) return { ...empty, complete: walk.complete };

  const txids = new Set<string>();
  let receivedZat = 0;
  let sentZat = 0;
  let firstHeight = walk.rows[0]!.block_height;
  let lastHeight = walk.rows[0]!.block_height;
  for (const row of walk.rows) {
    txids.add(row.txid);
    // A NULL `value_zat` (an unresolved input, or an output naming no single address) contributes
    // nothing, as in `recomputeAddresses`' balance SQL; the two must agree.
    const value = row.value_zat === null ? 0 : Number(row.value_zat);
    if (row.io === "out") receivedZat += value;
    else sentZat += value;
    if (row.block_height < firstHeight) firstHeight = row.block_height;
    if (row.block_height > lastHeight) lastHeight = row.block_height;
  }

  return {
    address,
    fromHeight: range.fromHeight,
    toHeight: range.toHeight,
    txCount: txids.size,
    receivedZat,
    sentZat,
    netZat: receivedZat - sentZat,
    firstHeight,
    lastHeight,
    complete: walk.complete,
    coversFromHeight: walk.coversFromHeight,
    lifetimeTxCount: lifetime,
  };
}
