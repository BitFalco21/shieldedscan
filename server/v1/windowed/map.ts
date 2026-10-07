import type { ChainWindowBucket, CrossChainVolumeSide } from "@/domain";
import { DAY_SECONDS, utcDayFromSeconds } from "@/domain/time";
import { zec } from "../format";
import type { PoolMigrationRaw } from "../../chain-window";
import type { FlowRow } from "./data";
import type {
  ActivityBucket,
  CrossChainSide,
  MigrationCell,
  AnalyticsCoverageStatus,
  AnalyticsPool,
  AnalyticsShare,
  ShieldingFlowBucket,
} from "./dto";

/**
 * Domain values to the windowed analytics' wire shapes. The one meeting point, as `server/v1/map.ts` is for /v1:
 * the DTOs import nothing, the routes call these.
 */

/** A fiat (or BTC) value as a decimal string: cents for fiat, satoshi precision for BTC. */
export function money(value: number, currency: string): string {
  return value.toFixed(currency === "btc" ? 8 : 2);
}

export function iso(ts: number): string {
  return new Date(ts * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** A share whose `pct` is null over an empty denominator; the analytics wire keeps the object. */
function analyticsShare(numerator: number, denominator: number): AnalyticsShare {
  return {
    pct: denominator > 0 ? Math.round((10_000 * numerator) / denominator) / 100 : null,
    numerator,
    denominator,
  };
}

export function activityBucket(
  b: ChainWindowBucket,
  byPool: ActivityBucket["transactions"]["byPool"],
  periodStart: string | null,
): ActivityBucket {
  const total = b.transparentTxs + b.mixedTxs + b.shieldedTxs;
  return {
    ...(periodStart === null ? {} : { periodStart }),
    blocks: b.blocks,
    transactions: {
      total,
      byKind: { transparent: b.transparentTxs, mixed: b.mixedTxs, fullyShielded: b.shieldedTxs },
      mixedByDirection: {
        shielding: b.shieldingTxs,
        unshielding: b.unshieldingTxs,
        indeterminate: b.indeterminateTxs,
      },
      byPool,
    },
    fullyShieldedShare: analyticsShare(b.shieldedTxs, total),
    fees: {
      feeZat: b.feeZat,
      feeZec: zec(b.feeZat),
      blocksCovered: b.blocksCovered,
      blocks: b.blocks,
    },
    ...(b.shieldingTxsOverFloor === undefined
      ? {}
      : {
          overFloor: {
            shielding: b.shieldingTxsOverFloor,
            unshielding: b.unshieldingTxsOverFloor ?? 0,
            priced: b.pricedCrossings ?? 0,
            considered: b.consideredCrossings ?? 0,
          },
        }),
  };
}

const amount = (zat: number, txs: number) => ({ txs, amountZat: zat, amountZec: zec(zat) });

/** All of one bucket's flow rows → one bucket, keeping only the pools asked for. */
export function flowBucket(
  rows: readonly FlowRow[],
  pools: readonly AnalyticsPool[],
  periodStart: string | null,
): ShieldingFlowBucket {
  const out: ShieldingFlowBucket = {
    ...(periodStart === null ? {} : { periodStart }),
    pools: {},
    unattributed: { txs: 0, magnitudeZat: 0, magnitudeZec: zec(0) },
  };
  for (const r of rows) {
    if (r.pool === "hub") {
      out.unattributed = { txs: r.hubTxs, magnitudeZat: r.hubZat, magnitudeZec: zec(r.hubZat) };
      continue;
    }
    if (!pools.includes(r.pool)) continue;
    const net = r.shieldedZat - r.unshieldedZat;
    out.pools[r.pool] = {
      shielded: amount(r.shieldedZat, r.shieldedTxs),
      unshielded: amount(r.unshieldedZat, r.unshieldedTxs),
      netZat: net,
      netZec: zec(net),
      coinbase: amount(r.coinbaseZat, r.coinbaseTxs),
    };
  }
  // A pool asked for that moved nothing is a measured ZERO, not an absent key.
  for (const p of pools) {
    out.pools[p] ??= {
      shielded: amount(0, 0),
      unshielded: amount(0, 0),
      netZat: 0,
      netZec: zec(0),
      coinbase: amount(0, 0),
    };
  }
  return out;
}

/** Sum flow rows across buckets, per pool, for the window totals. */
export function sumFlowRows(rows: readonly FlowRow[]): FlowRow[] {
  const byPool = new Map<string, FlowRow>();
  for (const r of rows) {
    const acc = byPool.get(r.pool) ?? {
      ...r,
      bucketTs: 0,
      shieldedTxs: 0,
      shieldedZat: 0,
      unshieldedTxs: 0,
      unshieldedZat: 0,
      coinbaseTxs: 0,
      coinbaseZat: 0,
      hubTxs: 0,
      hubZat: 0,
    };
    acc.shieldedTxs += r.shieldedTxs;
    acc.shieldedZat += r.shieldedZat;
    acc.unshieldedTxs += r.unshieldedTxs;
    acc.unshieldedZat += r.unshieldedZat;
    acc.coinbaseTxs += r.coinbaseTxs;
    acc.coinbaseZat += r.coinbaseZat;
    acc.hubTxs += r.hubTxs;
    acc.hubZat += r.hubZat;
    byPool.set(r.pool, acc);
  }
  return [...byPool.values()];
}

export function migrationCell(r: PoolMigrationRaw, currency: string): MigrationCell {
  return {
    source: r.source,
    destination: r.destination,
    txs: r.txCount,
    amountZat: r.amountZat,
    amountZec: zec(r.amountZat),
    value: {
      currency,
      amount: r.value === null ? null : money(r.value, currency),
      pricedTxs: r.pricedTxCount,
    },
  };
}

export function crossSide(s: CrossChainVolumeSide): CrossChainSide {
  return {
    transfers: s.transfers,
    amountZat: s.zecAmountZat,
    amountZec: zec(s.zecAmountZat),
    usdAtSwap: money(s.usdAtSwap, "usd"),
    usdPricedTransfers: s.usdCoveredTransfers,
  };
}

/**
 * The coverage verdict for a window, and the notes behind it.
 *
 * Three facts decide it, each measured rather than assumed:
 *  - whether the window reaches into today's unfinished UTC day (or beyond);
 *  - whether the daily totals have been refreshed past the window's last day — they are day
 *    matviews the follower refreshes on a timer, so a day that ended minutes ago may not be in
 *    them yet (`dailyThrough` is the newest day they hold, null where an endpoint reads no
 *    day matview);
 *  - any lower bound the endpoint itself reports (`floorNotes`).
 *
 * The status is the WEAKEST property that applies — partial over floor over complete — and the
 * notes list every one, so a response that is both partial and a floor says both.
 */
export function coverage(input: {
  toTimestamp: number;
  nowSeconds: number;
  dailyThrough: number | null;
  floorNotes: readonly string[];
}): { status: AnalyticsCoverageStatus; notes: string[] } {
  const todayStart = Math.floor(input.nowSeconds / DAY_SECONDS) * DAY_SECONDS;
  const notes: string[] = [];
  let partial = false;
  if (input.toTimestamp > todayStart) {
    partial = true;
    notes.push(
      input.toTimestamp > todayStart + DAY_SECONDS
        ? "The window reaches past today; figures cover only what has happened and been indexed so far."
        : "The window includes today (UTC), which is not over; figures cover what has been indexed so far.",
    );
  } else if (input.dailyThrough !== null && input.dailyThrough < input.toTimestamp) {
    partial = true;
    notes.push(
      `The daily totals are refreshed on a timer and currently run through ${utcDayFromSeconds(input.dailyThrough)}; the window's last day is not complete in them yet.`,
    );
  }
  notes.push(...input.floorNotes);
  const status: AnalyticsCoverageStatus = partial
    ? "partial"
    : input.floorNotes.length > 0
      ? "floor"
      : "complete";
  return { status, notes };
}
