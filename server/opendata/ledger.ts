import type { Client } from "pg";
import { nu7ActiveAt } from "@/domain/consensus";
import { blockSubsidyZat } from "@/domain/halving";
import { Findings } from "./checks";
import { checkLedgerStrings, LEDGER_TEXT_COLUMNS, type LedgerTextColumns } from "./ledger-strings";
import type { ColumnValues } from "./parquet";
import {
  LEDGER_PART_ROWS,
  POOL_COLUMNS,
  TRANSACTIONS_EXTRA_COLUMNS,
  TRANSPARENT_IO_COLUMNS,
} from "./tables";

/**
 * The transparent ledger, read one height range at a time and held to the blocks it belongs to.
 *
 * Two checks are independent of how the ledger was built: each block's change in the node's
 * transparent pool must equal its outputs minus its inputs, and each coinbase must claim no more
 * than the subsidy and the fees allow (what it leaves unclaimed is counted, never an error: ZIP
 * 236 is not part of NU7). The per-transaction fee identity only checks the export, since the
 * stored fee was derived from this same ledger.
 */

export interface LedgerTx {
  txid: string;
  block_height: number;
  kind: string;
  fee_zat: bigint | null;
  sprout_joinsplits: number | null;
  sprout_vpub_net_zat: bigint | null;
  sapling_value_balance_zat: bigint | null;
  orchard_value_balance_zat: bigint | null;
  ironwood_value_balance_zat: bigint | null;
  binding_sig_valid: boolean | null;
}

export interface LedgerIo {
  txid: string;
  block_height: number;
  io: string;
  ordinal: number;
  address: string | null;
  value_zat: bigint | null;
  script_type: string | null;
  prev_txid: string | null;
  prev_vout: number | null;
}

/** A block's fee total and every pool, which the underclaim needs when the fee is unknown. */
export type LedgerBlock = { height: number; total_fee_zat: bigint | null } & Record<
  (typeof POOL_COLUMNS)[number],
  bigint | null
>;

const BLOCK_COLS = ["height", "total_fee_zat", ...POOL_COLUMNS].join(", ");

/** The ledger's script types, by the names ZIP 317's size bounds need. */
const SCRIPT_KIND: Record<string, "p2pkh" | "p2sh" | "p2pk"> = {
  pubkeyhash: "p2pkh",
  scripthash: "p2sh",
  pubkey: "p2pk",
};

/** One row of `transactions_extra`, in its column order. */
function extraRow(tx: LedgerTx, ins: readonly LedgerIo[], outs: readonly LedgerIo[]) {
  const count = (rows: readonly LedgerIo[], kind: string | null) =>
    rows.filter((r) => (SCRIPT_KIND[r.script_type ?? ""] ?? null) === kind).length;
  const sum = (rows: readonly LedgerIo[]) => rows.reduce((s, r) => s + (r.value_zat ?? 0n), 0n);
  return [
    tx.txid,
    tx.block_height,
    ins.length,
    outs.length,
    sum(ins),
    sum(outs),
    count(ins, "p2pkh"),
    count(ins, "p2sh"),
    count(ins, "p2pk"),
    count(ins, null),
    count(outs, "p2pkh"),
    count(outs, "p2sh"),
    count(outs, "p2pk"),
    count(outs, null),
    tx.binding_sig_valid,
  ] as const;
}

/** A pool cell before the range, where a NULL is the unreported prefix (zero), never a gap. */
const orZero = (v: bigint | null) => v ?? 0n;

/**
 * What a block without a fee total left unclaimed, from the pools alone: its subsidy less what
 * every pool gained, the quantity `BlockChecker` bounds, and what the fee-based reading gives
 * wherever both apply (fees only move between pools). Null where it cannot be known: from NU7 the
 * NSM's share of the unknown fee is missing from the pools, and a pool that starts or stops
 * reporting at this block has no change to read (`BlockChecker`'s `sameShape`).
 */
function underclaimFromPools(prev: LedgerBlock | null, b: LedgerBlock): bigint | null {
  if (nu7ActiveAt("mainnet", b.height)) return null;
  if (prev === null ? b.height !== 0 : prev.height !== b.height - 1) return null;
  if (prev !== null && POOL_COLUMNS.some((col) => (b[col] === null) !== (prev[col] === null))) {
    return null;
  }
  const total = (r: LedgerBlock | null) =>
    POOL_COLUMNS.reduce((s, col) => s + orZero(r?.[col] ?? null), 0n);
  return BigInt(blockSubsidyZat(b.height)) - (total(b) - total(prev));
}

export class LedgerChecker {
  readonly failures = new Findings();
  /** Subsidy and fees that coinbases left unclaimed in the range, zatoshi. */
  underclaimZat = 0n;
  underclaimedBlocks = 0;
  /**
   * Blocks outside `underclaimZat` because their underclaim could not be derived: an unknown fee
   * total where the pools cannot stand in for it (`underclaimFromPools`). A NULL transparent pool
   * skips only the pool-against-ledger identity; its block's underclaim is still counted.
   */
  skippedBlocks = 0;

  constructor(private previous: LedgerBlock | null) {}

  /** A part's text columns, before it is written (`ledger-strings.ts`). */
  part(columns: LedgerTextColumns): void {
    checkLedgerStrings(this.failures, columns);
  }

  /** One block, its transactions in order, each with its inputs and outputs. */
  block(b: LedgerBlock, txs: readonly { tx: LedgerTx; ins: LedgerIo[]; outs: LedgerIo[] }[]) {
    const h = String(b.height);
    let ledgerDelta = 0n;
    let coinbaseOut = 0n;
    let coinbaseShielded = 0n;
    let coinbases = 0;

    for (const { tx, ins, outs } of txs) {
      for (const [rows, io] of [
        [ins, "in"],
        [outs, "out"],
      ] as const) {
        rows.forEach((r, i) => {
          if (r.io !== io || r.ordinal !== i)
            this.failures.add("ledger ordinals not contiguous", tx.txid);
          if (r.value_zat === null) this.failures.add(`${io}put without a value`, tx.txid);
          else if (r.value_zat < 0n) this.failures.add("negative ledger value", tx.txid);
        });
      }
      const inZat = ins.reduce((s, r) => s + (r.value_zat ?? 0n), 0n);
      const outZat = outs.reduce((s, r) => s + (r.value_zat ?? 0n), 0n);
      ledgerDelta += outZat - inZat;

      const bundles =
        orZero(tx.sapling_value_balance_zat) +
        orZero(tx.orchard_value_balance_zat) +
        orZero(tx.ironwood_value_balance_zat);
      if (tx.kind === "coinbase") {
        coinbases++;
        if (ins.length > 0) this.failures.add("coinbase with transparent inputs", tx.txid);
        coinbaseOut += outZat;
        coinbaseShielded += bundles;
      } else if (tx.fee_zat !== null) {
        // Bundle balances are domain sign (positive = into the pool); Sprout's public value is the
        // node's sign (positive = out of it), and 0 for a transaction without JoinSplits.
        const sprout = (tx.sprout_joinsplits ?? 0) > 0 ? orZero(tx.sprout_vpub_net_zat) : 0n;
        if (tx.fee_zat !== inZat - outZat - bundles + sprout) {
          this.failures.add("fee differs from the transaction's value balance", tx.txid);
        }
      }
    }
    if (coinbases !== 1) this.failures.add("block without exactly one coinbase", h);

    const prev = this.previous;
    const contiguous = prev !== null && prev.height === b.height - 1;
    if (b.height > 0 && !contiguous) this.failures.add("ledger range not contiguous", h);

    // The node's transparent pool against the ledger: independent of how either was built.
    if (
      b.transparent_pool_zat !== null &&
      b.transparent_pool_zat - orZero(prev?.transparent_pool_zat ?? null) !== ledgerDelta
    ) {
      this.failures.add("transparent pool change differs from the ledger", h);
    }

    // What the coinbase claimed against what the protocol allowed it.
    if (b.total_fee_zat === null) {
      const unclaimed = underclaimFromPools(prev, b);
      if (unclaimed === null) this.skippedBlocks++;
      else if (unclaimed < 0n) this.failures.add("pools grew by more than the subsidy", h);
      else if (unclaimed > 0n) {
        this.underclaimZat += unclaimed;
        this.underclaimedBlocks++;
      }
    } else {
      const lockboxDelta = orZero(b.lockbox_pool_zat) - orZero(prev?.lockbox_pool_zat ?? null);
      const nsm = nu7ActiveAt("mainnet", b.height) ? (b.total_fee_zat * 6n) / 10n : 0n;
      const claimed = coinbaseOut + coinbaseShielded + lockboxDelta + nsm;
      const allowed = BigInt(blockSubsidyZat(b.height)) + b.total_fee_zat;
      if (claimed > allowed) {
        this.failures.add("coinbase claimed more than the subsidy and fees", h);
      } else if (claimed < allowed) {
        this.underclaimZat += allowed - claimed;
        this.underclaimedBlocks++;
      }
    }
    this.previous = b;
  }
}

export interface LedgerRange {
  extra: ColumnValues[];
  parts: number;
  checker: LedgerChecker;
}

/** Called after each chunk with the milliseconds it took; "abort" stops the range (resumable). */
export type ChunkHook = (workedMs: number, rows: number) => Promise<"continue" | "abort">;

export class LedgerAbort extends Error {
  constructor() {
    super("ledger range stopped by the pacer");
    this.name = "LedgerAbort";
  }
}

export interface LedgerOptions {
  /**
   * Receives each finished part of the ledger, in order; its arrays are not reused after.
   * `failing` says a check has already failed in this range, so the part should not be written.
   */
  onPart: (io: ColumnValues[], part: number, failing: boolean) => void;
  afterChunk?: ChunkHook;
  /**
   * Block bytes per query. A ledger row needs at least 9 bytes of its block (an output), so this
   * bounds a query's rows BEFORE it runs, whatever the era: 8 MB is at most ~900k rows of dust and
   * ~200k of ordinary payments, well inside the 60 s statement timeout. Measured afterwards it
   * would be too late.
   */
  chunkBytes?: number;
  partRows?: number;
}

/** A query cancelled by `statement_timeout`. */
const QUERY_CANCELED = "57014";
/** Halvings of a chunk after timeouts before the range gives up. */
const TIMEOUT_RETRIES = 3;
/** Most heights a chunk spans, however small their blocks. */
const MAX_CHUNK_HEIGHTS = 2_000;

const TX_COLS =
  "txid, block_height, kind, fee_zat, sprout_joinsplits, sprout_vpub_net_zat, " +
  "sapling_value_balance_zat, orchard_value_balance_zat, ironwood_value_balance_zat, binding_sig_valid";

/**
 * The ledger and per-transaction totals for heights [start, end], read through the `opendata`
 * views in chunks bounded by their blocks' bytes, checked block by block. The caller owns the
 * transaction (one REPEATABLE READ snapshot per range) and the pacing between chunks; each chunk
 * runs under a savepoint, so a query the timeout cancels is retried on half the bytes.
 */
export async function readLedgerRange(
  client: Client,
  start: number,
  end: number,
  options: LedgerOptions,
): Promise<LedgerRange> {
  const afterChunk = options.afterChunk ?? (async () => "continue" as const);
  const chunkBytes = options.chunkBytes ?? 8_000_000;
  const partRows = options.partRows ?? LEDGER_PART_ROWS;
  let io: ColumnValues[] = TRANSPARENT_IO_COLUMNS.map(() => []);
  let parts = 0;
  const extra: ColumnValues[] = TRANSACTIONS_EXTRA_COLUMNS.map(() => []);
  const ioCols = TRANSPARENT_IO_COLUMNS.map((c) => c.name);
  const flush = () => {
    const column = (name: string) => io[ioCols.indexOf(name)]!;
    checker.part(
      Object.fromEntries(
        LEDGER_TEXT_COLUMNS.map((name) => [name, column(name)]),
      ) as LedgerTextColumns,
    );
    options.onPart(io, parts++, checker.failures.size > 0);
    io = TRANSPARENT_IO_COLUMNS.map(() => []);
  };

  const previous =
    start === 0
      ? null
      : ((
          await client.query<LedgerBlock>(
            `SELECT ${BLOCK_COLS}
               FROM opendata.blocks WHERE height = $1`,
            [start - 1],
          )
        ).rows[0] ?? null);
  const checker = new LedgerChecker(previous);

  /** The last height from `a` whose blocks, together, stay within `budget` bytes (at least one). */
  const chunkEnd = async (a: number, budget: number): Promise<number> => {
    const { rows } = await client.query<{ height: number; size_bytes: number }>(
      `SELECT height, size_bytes FROM opendata.blocks WHERE height BETWEEN $1 AND $2 ORDER BY height`,
      [a, Math.min(end, a + MAX_CHUNK_HEIGHTS - 1)],
    );
    let bytes = 0;
    let last = a;
    for (const row of rows) {
      bytes += row.size_bytes;
      if (bytes > budget && row.height > a) break;
      last = row.height;
    }
    return last;
  };

  const readChunk = async (a: number, b: number) =>
    [
      await client.query<LedgerBlock>(
        `SELECT ${BLOCK_COLS}
         FROM opendata.blocks WHERE height BETWEEN $1 AND $2 ORDER BY height`,
        [a, b],
      ),
      await client.query<LedgerTx>(
        `SELECT ${TX_COLS} FROM opendata.transactions WHERE block_height BETWEEN $1 AND $2
        ORDER BY block_height, txid COLLATE "C"`,
        [a, b],
      ),
      await client.query<LedgerIo>(
        `SELECT ${ioCols.join(", ")} FROM opendata.transparent_io
        WHERE block_height BETWEEN $1 AND $2
        ORDER BY block_height, txid COLLATE "C", io COLLATE "C", ordinal`,
        [a, b],
      ),
    ] as const;

  for (let a = start; a <= end;) {
    const began = Date.now();
    let budget = chunkBytes;
    let b = await chunkEnd(a, budget);
    let result;
    for (let attempt = 0; ; attempt++) {
      await client.query("SAVEPOINT ledger_chunk");
      try {
        result = await readChunk(a, b);
        await client.query("RELEASE SAVEPOINT ledger_chunk");
        break;
      } catch (e) {
        await client.query("ROLLBACK TO SAVEPOINT ledger_chunk");
        const timedOut = (e as { code?: unknown }).code === QUERY_CANCELED;
        if (!timedOut || attempt >= TIMEOUT_RETRIES || b === a) throw e;
        budget = Math.floor(budget / 2);
        b = await chunkEnd(a, budget);
      }
    }
    const [blocks, txs, rows] = result;

    let t = 0;
    let r = 0;
    for (const block of blocks.rows) {
      const inBlock: { tx: LedgerTx; ins: LedgerIo[]; outs: LedgerIo[] }[] = [];
      while (t < txs.rows.length && txs.rows[t]!.block_height === block.height) {
        const tx = txs.rows[t++]!;
        const ins: LedgerIo[] = [];
        const outs: LedgerIo[] = [];
        while (r < rows.rows.length && rows.rows[r]!.txid === tx.txid) {
          const row = rows.rows[r++]!;
          (row.io === "in" ? ins : outs).push(row);
          ioCols.forEach((c, i) => (io[i] as unknown[]).push(row[c as keyof LedgerIo] ?? null));
        }
        extraRow(tx, ins, outs).forEach((v, i) => (extra[i] as unknown[]).push(v));
        inBlock.push({ tx, ins, outs });
      }
      checker.block(block, inBlock);
      // Cut a part at a block boundary once it is full: where depends on the rows alone.
      if (io[0]!.length >= partRows) flush();
    }
    // Rows the merge never reached belong to no transaction in the range: a broken join.
    if (t !== txs.rows.length || r !== rows.rows.length) {
      checker.failures.add("ledger rows without a matching transaction", `${a}-${b}`);
    }
    if (blocks.rows.length !== b - a + 1) checker.failures.add("missing blocks", `${a}-${b}`);

    if ((await afterChunk(Date.now() - began, rows.rows.length)) === "abort") {
      throw new LedgerAbort();
    }
    a = b + 1;
  }
  if (io[0]!.length > 0 || parts === 0) flush();
  return { extra, parts, checker };
}
