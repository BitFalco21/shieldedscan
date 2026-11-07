import type { Pool } from "pg";
import "../../pg-types";

/**
 * One transparent address's history for a file, oldest first, a batch at a time.
 *
 * The same read `walkAddressIo` (`address-extremes.ts`) runs, ascending: a range of
 * `io_address_idx (address, block_height DESC)` in index order under a LIMIT, so a batch costs at
 * most its limit in heap pages whatever the address and whatever the planner's row estimate. The
 * index carries neither txid nor value, so grouping by transaction happens here, and a batch is cut
 * on a height boundary, because the overflow row's height may be partly fetched and a partial
 * transaction would sum to a wrong figure. A txid belongs to exactly one block, so every group a
 * batch keeps is whole.
 *
 * A height holding more of the address's rows than a batch is read whole: one block bounds it
 * (the widest transaction on the chain has 13,538 inputs).
 *
 * Every batch is one statement and no snapshot is held between them; the walk stops at the tip
 * read when the export began, so blocks arriving meanwhile never extend it. A reorg landing during
 * an export can change rows the walk has not reached yet, as it can between any two pages.
 */

export interface AddressTxRow {
  blockHeight: number;
  /** The block header's time, unix seconds. */
  timestamp: number;
  txid: string;
  kind: string;
  /** What the transaction paid this address. */
  receivedZat: number;
  /** What this address's inputs spent; null when one of them has no resolved value. */
  sentZat: number | null;
  /** The whole transaction's fee; null for a coinbase and where an input is unresolved. */
  feeZat: number | null;
}

export interface AddressBatch {
  rows: AddressTxRow[];
  /** The height the next batch starts above. */
  through: number;
  done: boolean;
}

interface IoRow {
  txid: string;
  io: "in" | "out";
  value_zat: number | null;
  block_height: number;
}

/** io rows a batch reads before grouping: about a second of cold heap reads at most. */
export const BATCH_IO_ROWS = 2_000;

export async function readAddressBatch(
  pool: Pool,
  address: string,
  above: number,
  tip: number,
  ioRows: number = BATCH_IO_ROWS,
): Promise<AddressBatch> {
  const { rows: fetched } = await pool.query<IoRow>(
    `SELECT txid, io, value_zat, block_height
       FROM tx_transparent_io
      WHERE address = $1 AND block_height > $2 AND block_height <= $3
      ORDER BY block_height ASC
      LIMIT $4`,
    [address, above, tip, ioRows + 1],
  );
  let rows = fetched;
  let through = tip;
  const done = fetched.length <= ioRows;
  if (!done) {
    const boundary = fetched[ioRows]!.block_height;
    rows = fetched.filter((r) => r.block_height < boundary);
    if (rows.length === 0) {
      const whole = await pool.query<IoRow>(
        `SELECT txid, io, value_zat, block_height
           FROM tx_transparent_io WHERE address = $1 AND block_height = $2`,
        [address, boundary],
      );
      rows = whole.rows;
      through = boundary;
    } else {
      through = rows.at(-1)!.block_height;
    }
  }
  return { rows: await withTransactions(pool, group(rows)), through, done };
}

interface Group {
  blockHeight: number;
  txid: string;
  receivedZat: number;
  sentZat: number | null;
}

/** Per transaction: the address's outputs and inputs summed, an unresolved input kept unknown. */
function group(rows: readonly IoRow[]): Group[] {
  const byTx = new Map<string, Group>();
  for (const r of rows) {
    let g = byTx.get(r.txid);
    if (g === undefined) {
      g = { blockHeight: r.block_height, txid: r.txid, receivedZat: 0, sentZat: 0 };
      byTx.set(r.txid, g);
    }
    if (r.io === "out") {
      // An output that names an address always carries its value; anything else breaks the index.
      if (r.value_zat === null) throw new Error(`an addressed output without a value in ${r.txid}`);
      g.receivedZat += r.value_zat;
    } else if (r.value_zat === null || g.sentZat === null) {
      g.sentZat = null;
    } else {
      g.sentZat += r.value_zat;
    }
  }
  return [...byTx.values()].sort((a, b) =>
    a.blockHeight !== b.blockHeight ? a.blockHeight - b.blockHeight : a.txid < b.txid ? -1 : 1,
  );
}

/** Each transaction's time, kind and fee: one primary-key read for the batch. */
async function withTransactions(pool: Pool, groups: Group[]): Promise<AddressTxRow[]> {
  if (groups.length === 0) return [];
  const { rows } = await pool.query<{
    txid: string;
    timestamp: number;
    kind: string;
    fee_zat: number | null;
  }>("SELECT txid, timestamp, kind, fee_zat FROM tx WHERE txid = ANY($1::text[])", [
    groups.map((g) => g.txid),
  ]);
  const facts = new Map(rows.map((r) => [r.txid, r]));
  return groups.map((g) => {
    const t = facts.get(g.txid);
    if (t === undefined) throw new Error(`an io row without its transaction: ${g.txid}`);
    return { ...g, timestamp: t.timestamp, kind: t.kind, feeZat: t.fee_zat };
  });
}
