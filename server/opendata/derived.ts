import { selfDeclaredMiner } from "@/domain/mining";
import { Findings, utcDay, type BlockRow } from "./checks";

/**
 * What the export derives or cross-checks beyond a single table: each block's transactions held to
 * what the block itself records, and the daily block and mining series computed from the blocks as
 * they stream past, so they cost the database nothing.
 */

/** What a block says about its transactions, kept compactly for all of history. */
export class BlockExpectations {
  private readonly txs: Int32Array;
  private readonly transparent: Int32Array;
  private readonly mixed: Int32Array;
  private readonly shielded: Int32Array;
  private readonly fee: BigInt64Array;
  private readonly feeKnown: Uint8Array;

  constructor(readonly height: number) {
    const n = height + 1;
    this.txs = new Int32Array(n).fill(-1);
    this.transparent = new Int32Array(n);
    this.mixed = new Int32Array(n);
    this.shielded = new Int32Array(n);
    this.fee = new BigInt64Array(n);
    this.feeKnown = new Uint8Array(n);
  }

  record(row: BlockRow): void {
    const h = row.height;
    if (h < 0 || h > this.height) return;
    this.txs[h] = row.tx_count;
    this.transparent[h] = row.transparent_tx_count;
    this.mixed[h] = row.mixed_tx_count;
    this.shielded[h] = row.shielded_tx_count;
    if (row.total_fee_zat !== null) {
      this.fee[h] = row.total_fee_zat;
      this.feeKnown[h] = 1;
    }
  }

  at(h: number) {
    return {
      txs: this.txs[h]!,
      transparent: this.transparent[h]!,
      mixed: this.mixed[h]!,
      shielded: this.shielded[h]!,
      fee: this.feeKnown[h] ? this.fee[h]! : null,
    };
  }
}

export interface TxRow {
  txid: string;
  block_height: number;
  kind: string;
  direction: string | null;
  fee_zat: bigint | null;
}

const KINDS = new Set(["transparent", "shielded", "mixed", "coinbase"]);
const DIRECTIONS = new Set(["shielding", "unshielding", "indeterminate"]);

/**
 * Every block's transactions must add up to what the block records: as many of them, as many of
 * each kind, and (where the block's fee total is known) fees that sum to it exactly.
 */
export class TxChecker {
  readonly failures = new Findings();
  private height = -1;
  private count = 0;
  private transparent = 0;
  private mixed = 0;
  private shielded = 0;
  private fees = 0n;
  private feesUnknown = 0;
  private checkedUpTo = -1;

  constructor(private readonly blocks: BlockExpectations) {}

  push(tx: TxRow): void {
    if (tx.block_height !== this.height) {
      if (tx.block_height < this.height) {
        this.failures.add("transactions out of height order", String(tx.block_height));
      }
      this.close();
      this.height = tx.block_height;
    }
    if (!/^[0-9a-f]{64}$/.test(tx.txid))
      this.failures.add("malformed txid", String(tx.block_height));
    if (!KINDS.has(tx.kind)) this.failures.add("unknown kind", `${tx.block_height} ${tx.kind}`);
    if (
      tx.kind === "mixed"
        ? tx.direction === null || !DIRECTIONS.has(tx.direction)
        : tx.direction !== null
    ) {
      this.failures.add("direction does not match kind", tx.txid);
    }
    this.count++;
    if (tx.kind === "transparent") this.transparent++;
    else if (tx.kind === "mixed") this.mixed++;
    else if (tx.kind === "shielded") this.shielded++;
    if (tx.kind !== "coinbase") {
      if (tx.fee_zat === null) this.feesUnknown++;
      else {
        if (tx.fee_zat < 0n) this.failures.add("negative fee", tx.txid);
        this.fees += tx.fee_zat;
      }
    }
  }

  /** Compares the block just finished, and any block skipped since the last, with its record. */
  private close(): void {
    if (this.height < 0) return;
    for (let h = this.checkedUpTo + 1; h < this.height; h++) {
      if (this.blocks.at(h).txs !== 0)
        this.failures.add("block with no transactions exported", String(h));
    }
    const e = this.blocks.at(this.height);
    const h = String(this.height);
    if (e.txs !== this.count) this.failures.add("transaction count differs from the block's", h);
    if (
      e.transparent !== this.transparent ||
      e.mixed !== this.mixed ||
      e.shielded !== this.shielded
    ) {
      this.failures.add("transaction kinds differ from the block's counts", h);
    }
    if (e.fee !== null && (this.feesUnknown > 0 || this.fees !== e.fee)) {
      this.failures.add("transaction fees do not sum to the block's fee", h);
    }
    this.checkedUpTo = this.height;
    this.count = this.transparent = this.mixed = this.shielded = this.feesUnknown = 0;
    this.fees = 0n;
  }

  /** Closes the last block and requires every height up to the release to have been seen. */
  finish(): void {
    this.close();
    for (let h = this.checkedUpTo + 1; h <= this.blocks.height; h++) {
      if (this.blocks.at(h).txs !== 0)
        this.failures.add("block with no transactions exported", String(h));
    }
  }
}

/** Nearest-rank percentile of sorted values: the smallest value at or above that share. */
function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]!;
}

interface DayBlocks {
  blocks: number;
  intervals: number[];
  bytes: number;
  difficulty: number;
  difficultyCount: number;
  fees: bigint;
  blocksWithFees: number;
}

/**
 * Per UTC day: blocks, the spacing between them, average size and difficulty, and fees. An
 * interval belongs to the later block's day; a miner's clock can make one negative, which is
 * kept as recorded rather than corrected.
 */
export class DailyBlocks {
  private readonly days = new Map<string, DayBlocks>();
  private prevTimestamp: bigint | null = null;

  push(row: BlockRow): void {
    const day = utcDay(row.timestamp);
    const d = this.days.get(day) ?? {
      blocks: 0,
      intervals: [],
      bytes: 0,
      difficulty: 0,
      difficultyCount: 0,
      fees: 0n,
      blocksWithFees: 0,
    };
    d.blocks++;
    if (this.prevTimestamp !== null) d.intervals.push(Number(row.timestamp - this.prevTimestamp));
    d.bytes += row.size_bytes;
    if (row.difficulty !== null) {
      d.difficulty += row.difficulty;
      d.difficultyCount++;
    }
    if (row.total_fee_zat !== null) {
      d.fees += row.total_fee_zat;
      d.blocksWithFees++;
    }
    this.days.set(day, d);
    this.prevTimestamp = row.timestamp;
  }

  rows(finalDay: string): Record<string, unknown>[] {
    return [...this.days.keys()]
      .filter((day) => day <= finalDay)
      .sort()
      .map((day) => {
        const d = this.days.get(day)!;
        const sorted = [...d.intervals].sort((a, b) => a - b);
        return {
          day,
          blocks: d.blocks,
          median_interval_s: percentile(sorted, 0.5),
          p90_interval_s: percentile(sorted, 0.9),
          max_interval_s: sorted.length > 0 ? sorted[sorted.length - 1]! : null,
          avg_size_bytes: d.bytes / d.blocks,
          avg_difficulty: d.difficultyCount > 0 ? d.difficulty / d.difficultyCount : null,
          fees_zat: d.fees,
          blocks_with_fees: d.blocksWithFees,
        };
      });
  }
}

/**
 * Blocks per UTC day by the operator that named itself in the coinbase, from the site's fixed list
 * (`selfDeclaredMiner`); anything else is `unidentified`. Only those names leave the database,
 * never the coinbase text, and a name is a claim the miner made, not proof.
 */
export class DailyMining {
  private readonly counts = new Map<string, number>();

  push(timestamp: bigint, coinbaseTag: string | null): void {
    const key = JSON.stringify([
      utcDay(timestamp),
      selfDeclaredMiner(coinbaseTag) ?? "unidentified",
    ]);
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
  }

  rows(finalDay: string): Record<string, unknown>[] {
    return [...this.counts]
      .map(([key, blocks]) => {
        const [day, miner] = JSON.parse(key) as [string, string];
        return { day, miner, blocks };
      })
      .filter((r) => r.day <= finalDay)
      .sort((a, b) =>
        a.day < b.day ? -1 : a.day > b.day ? 1 : a.miner < b.miner ? -1 : a.miner > b.miner ? 1 : 0,
      );
  }
}
