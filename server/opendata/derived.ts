import { MAX_TAG_LENGTH } from "@/data/chain/coinbase-tag";
import { selfDeclaredMiner } from "@/domain/mining";
import { printableOnly } from "@/lib/printable";
import { addDays, byCodePoint, Findings, utcDay, type BlockRow } from "./checks";
import { isMainnetTransparentAddress } from "./site-checks";

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
  private readonly saplingFlow: BigInt64Array;
  private readonly orchardFlow: BigInt64Array;

  constructor(readonly height: number) {
    const n = height + 1;
    this.txs = new Int32Array(n).fill(-1);
    this.transparent = new Int32Array(n);
    this.mixed = new Int32Array(n);
    this.shielded = new Int32Array(n);
    this.fee = new BigInt64Array(n);
    this.feeKnown = new Uint8Array(n);
    this.saplingFlow = new BigInt64Array(n);
    this.orchardFlow = new BigInt64Array(n);
  }

  record(row: BlockRow): void {
    const h = row.height;
    if (h < 0 || h > this.height) return;
    this.txs[h] = row.tx_count;
    this.transparent[h] = row.transparent_tx_count;
    this.mixed[h] = row.mixed_tx_count;
    this.shielded[h] = row.shielded_tx_count;
    this.saplingFlow[h] = row.sapling_flow_zat;
    this.orchardFlow[h] = row.orchard_flow_zat;
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
      saplingFlow: this.saplingFlow[h]!,
      orchardFlow: this.orchardFlow[h]!,
    };
  }
}

export interface TxRow {
  txid: string;
  block_height: number;
  kind: string;
  direction: string | null;
  fee_zat: bigint | null;
  sprout_joinsplits: number | null;
  sprout_vpub_net_zat: bigint | null;
  sapling_value_balance_zat: bigint | null;
  orchard_value_balance_zat: bigint | null;
}

const KINDS = new Set(["transparent", "shielded", "mixed", "coinbase"]);
const DIRECTIONS = new Set(["shielding", "unshielding", "indeterminate"]);

/**
 * Every block's transactions must add up to what the block records: as many of them, as many of
 * each kind, (where the block's fee total is known) fees that sum to it exactly, and Sapling and
 * Orchard balances that sum to the pool flows the node reported for the block.
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
  private sapling = 0n;
  private orchard = 0n;
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
    // JoinSplits whose public value was never derived: the pool flows would silently skip them.
    if ((tx.sprout_joinsplits ?? 0) > 0 && tx.sprout_vpub_net_zat === null) {
      this.failures.add("Sprout JoinSplits without their public value", tx.txid);
    }
    this.count++;
    this.sapling += tx.sapling_value_balance_zat ?? 0n;
    this.orchard += tx.orchard_value_balance_zat ?? 0n;
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
    if (this.sapling !== e.saplingFlow || this.orchard !== e.orchardFlow) {
      this.failures.add("transaction balances do not sum to the block's pool flows", h);
    }
    this.checkedUpTo = this.height;
    this.count = this.transparent = this.mixed = this.shielded = this.feesUnknown = 0;
    this.fees = this.sapling = this.orchard = 0n;
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

/** A block's row in `opendata.block_miners`, read alongside `opendata.blocks`. */
export interface MinerRow {
  height: number;
  timestamp: bigint;
  miner_address: string | null;
  coinbase_tag: string | null;
}

/**
 * The form `decodeCoinbaseTag` leaves a tag in: printable characters, whitespace collapsed to
 * single spaces with none leading, non-empty, and capped. Checked as properties rather than by
 * decoding again, because the cap can cut after a space the trim had kept.
 */
export function isSanitisedCoinbaseTag(tag: string): boolean {
  return (
    tag.length > 0 &&
    tag.length <= MAX_TAG_LENGTH &&
    printableOnly(tag) === tag &&
    !/[^\S ]| {2}|^ /.test(tag)
  );
}

/**
 * `blocks_coinbase` row by row against the block it belongs to: the same height, a payout
 * address exactly when the block's miner is transparent, each address a mainnet t-address, and
 * the miner's text in its sanitised form. A failure names the height, never the value: a value
 * that failed could be anything.
 */
export class CoinbaseChecker {
  readonly failures = new Findings();
  /** Addresses already validated: a few thousand payout addresses cover millions of blocks. */
  private readonly valid = new Set<string>();

  push(block: BlockRow, miner: MinerRow | undefined): void {
    const h = String(block.height);
    if (miner === undefined || miner.height !== block.height) {
      this.failures.add("blocks_coinbase out of step with blocks", h);
      return;
    }
    const address = miner.miner_address;
    if ((block.miner_kind === "transparent") !== (address !== null)) {
      this.failures.add("miner_address does not match miner_kind", h);
    }
    if (address !== null && !this.valid.has(address)) {
      if (isMainnetTransparentAddress(address)) this.valid.add(address);
      else this.failures.add("miner_address is not a mainnet t-address", h);
    }
    if (miner.coinbase_tag !== null && !isSanitisedCoinbaseTag(miner.coinbase_tag)) {
      this.failures.add("coinbase_tag is not in its sanitised form", h);
    }
  }
}

/** The days a trailing window covers, ending on (and including) its day. */
export const CONCENTRATION_WINDOW_DAYS = 30;

interface DayMiners {
  blocks: number;
  transparent: number;
  shielded: number;
  noAddress: number;
  /** Blocks whose miner the indexer has not recorded: any window holding one has no shares. */
  unrecorded: number;
  byAddress: Map<string, number>;
}

/**
 * Block production by payout address over the 30 UTC days ending each day with blocks. Shares are
 * the top one, three and five addresses' blocks over every block in the window, so shielded
 * coinbases and coinbases naming no address are counted and never attributed to anyone. A window
 * holding a block whose miner is not recorded has no distinct count and no shares (NULL), never
 * a figure computed without it. Fed per block by the stream, or per row by the site's payouts,
 * so the two can be held to each other.
 */
export class MiningConcentration {
  private readonly days = new Map<string, DayMiners>();

  push(day: string, kind: string | null, address: string | null, blocks = 1): void {
    const d = this.days.get(day) ?? {
      blocks: 0,
      transparent: 0,
      shielded: 0,
      noAddress: 0,
      unrecorded: 0,
      byAddress: new Map<string, number>(),
    };
    d.blocks += blocks;
    if (kind === "transparent" && address !== null) {
      d.transparent += blocks;
      d.byAddress.set(address, (d.byAddress.get(address) ?? 0) + blocks);
    } else if (kind === "shielded") d.shielded += blocks;
    else if (kind === "unknown") d.noAddress += blocks;
    else d.unrecorded += blocks;
    this.days.set(day, d);
  }

  rows(finalDay: string): Record<string, unknown>[] {
    const days = [...this.days.keys()].filter((day) => day <= finalDay).sort(byCodePoint);
    const window = new Map<string, number>();
    const sum = { blocks: 0, transparent: 0, shielded: 0, noAddress: 0, unrecorded: 0 };
    const move = (d: DayMiners, sign: 1 | -1) => {
      sum.blocks += sign * d.blocks;
      sum.transparent += sign * d.transparent;
      sum.shielded += sign * d.shielded;
      sum.noAddress += sign * d.noAddress;
      sum.unrecorded += sign * d.unrecorded;
      for (const [address, n] of d.byAddress) {
        const left = (window.get(address) ?? 0) + sign * n;
        if (left === 0) window.delete(address);
        else window.set(address, left);
      }
    };
    let oldest = 0;
    return days.map((day) => {
      move(this.days.get(day)!, 1);
      const start = addDays(day, 1 - CONCENTRATION_WINDOW_DAYS);
      while (days[oldest]! < start) move(this.days.get(days[oldest++]!)!, -1);
      const known = sum.unrecorded === 0;
      const top = known ? [...window.values()].sort((a, b) => b - a) : [];
      const share = (n: number) =>
        known ? top.slice(0, n).reduce((s, x) => s + x, 0) / sum.blocks : null;
      return {
        day,
        blocks: sum.blocks,
        transparent_blocks: sum.transparent,
        shielded_blocks: sum.shielded,
        no_address_blocks: sum.noAddress,
        distinct_addresses: known ? window.size : null,
        top1_share: share(1),
        top3_share: share(3),
        top5_share: share(5),
      };
    });
  }
}
