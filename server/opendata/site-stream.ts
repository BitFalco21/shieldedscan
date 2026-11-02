import { nu7ActiveAt } from "@/domain/consensus";
import { byCodePoint, utcDay, type BlockRow } from "./checks";
import { DailyBoundary, type BoundaryTx } from "./site-boundary";
import { POOL_COLUMNS } from "./tables";

/**
 * The site's block- and transaction-derived series, computed from the rows the export already
 * streams, so they are exact at the release height whatever the site's refresh timers did. The
 * site's own tables are then held against these day by day (`site-checks.ts`).
 */

type PoolColumn = (typeof POOL_COLUMNS)[number];

interface DayClose {
  top_height: number;
  hash: string;
  pools: Record<PoolColumn, bigint | null>;
}

interface DayMiners {
  /** The miner's share of fees over the blocks whose fee total is known (ZIP 235 from NU7). */
  feeShare: bigint;
  /** Blocks per recorded `miner_kind`, and `unrecorded` for blocks with none. */
  kinds: Map<string, number>;
  transparentReward: bigint;
  transparentRewardUnknown: number;
}

/** `miner_kind`'s values, and `unrecorded` for a block without one. */
export const MINER_KINDS = ["transparent", "shielded", "unknown", "unrecorded"] as const;

/** The miner's share of one block's fees: all of it before NU7, less floor(6 × fees / 10) from it. */
export function minerFeeShare(height: number, fee: bigint): bigint {
  return nu7ActiveAt("mainnet", height) ? fee - (fee * 6n) / 10n : fee;
}

export class SiteStream {
  private readonly kinds = new Map<string, [number, number, number]>();
  private readonly closes = new Map<string, DayClose>();
  private readonly miners = new Map<string, DayMiners>();
  private readonly feeTxs = new Map<string, number>();
  readonly boundary = new DailyBoundary();

  /** Blocks in height order: a day's close is then simply the last of its blocks seen. */
  pushBlock(row: BlockRow): void {
    const day = utcDay(row.timestamp);
    const k = this.kinds.get(day) ?? [0, 0, 0];
    k[0] += row.transparent_tx_count;
    k[1] += row.mixed_tx_count;
    k[2] += row.shielded_tx_count;
    this.kinds.set(day, k);

    const pools = {} as Record<PoolColumn, bigint | null>;
    for (const col of POOL_COLUMNS) pools[col] = row[col];
    this.closes.set(day, { top_height: row.height, hash: row.hash, pools });

    const m = this.miners.get(day) ?? {
      feeShare: 0n,
      kinds: new Map<string, number>(),
      transparentReward: 0n,
      transparentRewardUnknown: 0,
    };
    if (row.total_fee_zat !== null) m.feeShare += minerFeeShare(row.height, row.total_fee_zat);
    const kind = row.miner_kind ?? "unrecorded";
    m.kinds.set(kind, (m.kinds.get(kind) ?? 0) + 1);
    if (row.miner_kind === "transparent") {
      if (row.miner_reward_zat === null) m.transparentRewardUnknown++;
      else m.transparentReward += row.miner_reward_zat;
    }
    this.miners.set(day, m);
  }

  /** Transactions, in any order. */
  pushTx(tx: BoundaryTx): void {
    const day = utcDay(tx.timestamp);
    this.boundary.push(tx, day);
    if (tx.kind !== "coinbase" && tx.fee_zat !== null) {
      const key = `${day.slice(0, 7)}-01 ${tx.kind}`;
      this.feeTxs.set(key, (this.feeTxs.get(key) ?? 0) + 1);
    }
  }

  /** Transactions by kind per UTC day, coinbase excluded, as the blocks record them. */
  txKindRows(finalDay: string): Record<string, unknown>[] {
    return [...this.kinds.keys()]
      .filter((day) => day <= finalDay)
      .sort(byCodePoint)
      .map((day) => {
        const [transparent, mixed, shielded] = this.kinds.get(day)!;
        return { day, transparent_txs: transparent, mixed_txs: mixed, shielded_txs: shielded };
      });
  }

  /** Each value pool at each UTC day's last block (the highest height stamped that day). */
  poolRows(finalDay: string): Record<string, unknown>[] {
    return [...this.closes.keys()]
      .filter((day) => day <= finalDay)
      .sort(byCodePoint)
      .map((day) => {
        const c = this.closes.get(day)!;
        return { day, top_height: c.top_height, hash: c.hash, ...c.pools };
      });
  }

  /**
   * Per UTC day, what `mining_day_payout` should sum to: blocks per miner kind, the miner's fee
   * share, and the transparent miners' rewards (unknown if any block's is).
   */
  minerRows(finalDay: string): Record<string, unknown>[] {
    return [...this.miners.keys()]
      .filter((day) => day <= finalDay)
      .sort(byCodePoint)
      .map((day) => {
        const m = this.miners.get(day)!;
        return {
          day,
          ...Object.fromEntries(MINER_KINDS.map((k) => [`${k}_blocks`, m.kinds.get(k) ?? 0])),
          fee_zat: m.feeShare,
          reward_zat: m.transparentRewardUnknown > 0 ? null : m.transparentReward,
        };
      });
  }

  /** Every UTC day that has a block. */
  days(): string[] {
    return [...this.kinds.keys()];
  }

  /** Transactions with a known fee per (first day of the UTC month, kind), coinbase excluded. */
  feeTxRows(): { month: string; kind: string; txs: number }[] {
    return [...this.feeTxs].map(([key, txs]) => {
      const [month, kind] = key.split(" ") as [string, string];
      return { month, kind, txs };
    });
  }
}
