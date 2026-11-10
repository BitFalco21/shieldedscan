import type {
  BlocksDayPoint,
  ChainInflowPoint,
  ChainOutflowPoint,
  InflowKindMonthPoint,
  DestinationBucket,
  DestinationWindows,
  SupplyDayPoint,
  VenueMonthPoint,
  MinerShareMonth,
  NoteTreeDayPoint,
  ReorgWeekSeries,
  OrphanRateSeries,
  OrphanRateSpan,
  TransparentDayPoint,
} from "@/domain";
import { classifyZcashAddress } from "@/domain/address";
import { ORPHAN_RATE_DAYS } from "@/domain/reorg";
import { SETTLEMENT_ASSETS, countsTowardTotals } from "@/domain/crosschain";
import { DESTINATION_WINDOW_DAYS } from "@/domain/destinations";
import { crossChainTransfers } from "./crosschain";
import { TIP_HEIGHT, TIP_TIME } from "./ids";
import { getDailySeries, getMonthlySeries, getReorgSummary, listReorgEvents } from "./index";

/**
 * Sample series for the chart library's newer charts, each derived from the fixtures that
 * already exist so that, in fixture mode, one page never shows two stories: transparent activity from the sample transparent counts, and so on.
 */

const DAY = 86_400;

/**
 * Sapling from its 2018 activation, Orchard from 2022, Ironwood over the second half of the
 * series: absent then present, so a preview draws both the pool's activation and the days the
 * readout can total all three.
 */
export function getNoteTrees(): NoteTreeDayPoint[] {
  const days = getDailySeries();
  const half = Math.floor(days.length / 2);
  return days.map((d, i) => ({
    timestamp: d.timestamp,
    saplingNotes: 73_000_000 + i * 2_700,
    orchardNotes: 49_500_000 + i * 2_600,
    ironwoodNotes: i >= half ? (i - half) * 9_000 + 4_000 : null,
  }));
}

export function getTransparentDays(): TransparentDayPoint[] {
  return getDailySeries().map((d) => ({
    timestamp: d.timestamp,
    activeAddresses: Math.round((d.transparentTxs + d.mixedTxs) * 1.4),
  }));
}

export function getMinerShares(): MinerShareMonth[] {
  return getMonthlySeries().map((m, i) => {
    const blocks = 34_560;
    return {
      timestamp: m.timestamp,
      blocks,
      days: 30,
      top1Blocks: Math.round(blocks * (0.32 + 0.06 * Math.sin(i / 3))),
      top3Blocks: Math.round(blocks * (0.66 + 0.05 * Math.sin(i / 4))),
      top10Blocks: Math.round(blocks * 0.93),
      shieldedBlocks: Math.round(blocks * 0.02 * (1 + Math.sin(i / 5))),
    };
  });
}

export function getReorgWeeks(): ReorgWeekSeries {
  const { observingSince } = getReorgSummary();
  const events = listReorgEvents({ limit: 100 }).items;
  const monday = (ts: number) => {
    const day = Math.floor(ts / DAY) * DAY;
    const weekday = (new Date(day * 1000).getUTCDay() + 6) % 7;
    return day - weekday * DAY;
  };
  const start = monday(observingSince);
  const end = monday(Math.max(observingSince, ...events.map((e) => e.detectedAt)));
  const weeks: ReorgWeekSeries["weeks"] = [];
  for (let ts = start; ts <= end; ts += 7 * DAY) {
    const inWeek = events.filter((e) => e.detectedAt >= ts && e.detectedAt < ts + 7 * DAY);
    weeks.push({
      timestamp: ts,
      reorgs: inWeek.length,
      deepest: Math.max(0, ...inWeek.map((e) => e.depth)),
    });
  }
  return { observingSince, weeks };
}

/**
 * The orphan rate over the fixture's observed span, read at the fixture tip: blocks every 75 s
 * until a sample upgrade three days back and every 25 s after, the shape NU7 gave mainnet, and an
 * orphan for each block the fixture reorgs discarded, filed at the time each was detected.
 */
export function getOrphanRate(): OrphanRateSeries {
  const { observingSince } = getReorgSummary();
  const asOf = TIP_TIME;
  const today = Math.floor(asOf / DAY) * DAY;
  const upgradeAt = today - 3 * DAY + 2 * 3_600 + 34 * 60;
  const blocks: number[] = [];
  for (let ts = asOf; ts >= observingSince; ts -= ts > upgradeAt ? 25 : 75) blocks.push(ts);
  const orphans = listReorgEvents({ limit: 100 }).items.map((e) => ({
    at: e.detectedAt - 30,
    count: e.depth,
  }));
  const span = (keep: (ts: number) => boolean): OrphanRateSpan => ({
    blocks: blocks.filter(keep).length,
    orphans: orphans.filter((o) => keep(o.at)).reduce((sum, o) => sum + o.count, 0),
  });
  const firstDay = Math.max(
    today - (ORPHAN_RATE_DAYS - 1) * DAY,
    Math.floor(observingSince / DAY) * DAY,
  );
  const days: OrphanRateSeries["days"] = [];
  for (let ts = firstDay; ts <= today; ts += DAY) {
    days.push({
      timestamp: ts,
      ...span((t) => t >= ts && t < ts + DAY),
      partial: ts === today || observingSince > ts,
    });
  }
  const window = (
    key: OrphanRateSeries["windows"][number]["key"],
    keep: (ts: number) => boolean,
  ) => {
    const kept = blocks.filter(keep);
    return {
      key,
      ...span(keep),
      // Newest first, as walked back from the tip.
      firstBlockAt: kept.at(-1) ?? null,
      lastBlockAt: kept[0] ?? null,
    };
  };
  const upgradeHeight = TIP_HEIGHT - blocks.filter((ts) => ts >= upgradeAt).length + 1;
  return {
    observingSince,
    asOf,
    upgrade: { name: "NU7", height: upgradeHeight, activatedAt: upgradeAt },
    days,
    windows: [
      window("24h", (ts) => ts > asOf - DAY),
      window("7d", (ts) => ts > asOf - 7 * DAY),
      window("30d", (ts) => ts > asOf - 30 * DAY),
      window("before-upgrade", (ts) => ts < upgradeAt),
      window("since-upgrade", (ts) => ts >= upgradeAt),
    ],
  };
}

export function getChainInflow(): ChainInflowPoint[] {
  const by = new Map<string, ChainInflowPoint>();
  for (const t of crossChainTransfers) {
    if (t.direction !== "in" || SETTLEMENT_ASSETS.includes(t.counterpartAsset)) continue;
    const d = new Date(t.timestamp * 1000);
    const timestamp = Date.UTC(d.getUTCFullYear(), d.getUTCMonth()) / 1000;
    const key = `${timestamp}:${t.counterpartChain}`;
    const point = by.get(key) ?? { timestamp, chain: t.counterpartChain, inZat: 0 };
    point.inZat += t.zecAmountZat;
    by.set(key, point);
  }
  return [...by.values()].sort(
    (a, b) => a.timestamp - b.timestamp || a.chain.localeCompare(b.chain),
  );
}

/** The first instant of the UTC month holding `seconds`. */
const monthOf = (seconds: number) => {
  const d = new Date(seconds * 1000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth()) / 1000;
};

const swaps = (direction: "in" | "out" | null) =>
  crossChainTransfers.filter(
    (t) =>
      (direction === null || t.direction === direction) &&
      !SETTLEMENT_ASSETS.includes(t.counterpartAsset),
  );

export function getChainOutflow(): ChainOutflowPoint[] {
  const by = new Map<string, ChainOutflowPoint>();
  for (const t of swaps("out")) {
    const timestamp = monthOf(t.timestamp);
    const key = `${timestamp}:${t.counterpartChain}`;
    const point = by.get(key) ?? { timestamp, chain: t.counterpartChain, outZat: 0 };
    point.outZat += t.zecAmountZat;
    by.set(key, point);
  }
  return [...by.values()].sort(
    (a, b) => a.timestamp - b.timestamp || a.chain.localeCompare(b.chain),
  );
}

export function getVenueMonths(): VenueMonthPoint[] {
  const by = new Map<string, VenueMonthPoint>();
  for (const t of swaps(null)) {
    const timestamp = monthOf(t.timestamp);
    const key = `${timestamp}:${t.protocol}`;
    const point = by.get(key) ?? { timestamp, protocol: t.protocol, inZat: 0, outZat: 0 };
    if (t.direction === "in") point.inZat += t.zecAmountZat;
    else point.outZat += t.zecAmountZat;
    by.set(key, point);
  }
  return [...by.values()].sort((a, b) => a.timestamp - b.timestamp);
}

export function getInflowKinds(): InflowKindMonthPoint[] {
  const by = new Map<string, InflowKindMonthPoint>();
  for (const t of swaps("in")) {
    const timestamp = monthOf(t.timestamp);
    const kind = classifyZcashAddress(t.zcashAddress);
    const key = `${timestamp}:${kind}`;
    const point = by.get(key) ?? { timestamp, kind, transfers: 0, zat: 0 };
    point.transfers += 1;
    point.zat += t.zecAmountZat;
    by.set(key, point);
  }
  return [...by.values()].sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * From the fixture days' pool balances: transparent held at a steady multiple of the shielded
 * total, and a lockbox filling over the last year, as NU6's did.
 */
export function getSupplyDays(): SupplyDayPoint[] {
  const days = getDailySeries();
  const lockboxFrom = days.length - 330;
  return days.map((d, i) => {
    const shielded = d.sproutZat + d.saplingZat + d.orchardZat + d.ironwoodZat;
    return {
      timestamp: d.timestamp,
      transparentZat: Math.round(shielded * 2.4),
      sproutZat: d.sproutZat,
      saplingZat: d.saplingZat,
      orchardZat: d.orchardZat || null,
      ironwoodZat: d.ironwoodZat || null,
      lockboxZat: i < lockboxFrom ? null : (i - lockboxFrom) * 22_500_000_000,
    };
  });
}

/** From the fixture network days: each day's count and a top height on the post-Blossom side. */
export function getBlocksDaily(): BlocksDayPoint[] {
  let height = 3_000_000;
  return getDailySeries()
    .slice(0, -1)
    .map((d, i) => {
      const blocks = 1_152 + Math.round(18 * Math.sin(i / 2));
      height += blocks;
      return { timestamp: d.timestamp, blocks, topHeight: height };
    });
}

/**
 * Older inbound swaps for the shielded-capable-by-chain chart, as (chain, family, swaps, days ago):
 * the fixture chain's own crossings name five chains with one published family each, which can
 * neither fold a tail nor show a swap whose venue published no address. These do both, and give
 * one chain (ARB) nothing but unpublished addresses, so a row with no share is drawn too.
 */
const DESTINATION_HISTORY: [string, DestinationBucket["kind"], number, number][] = [
  ["BTC", "unified", 40, 10],
  ["BTC", "transparent", 55, 12],
  ["BTC", null, 6, 20],
  ["BTC", "sapling", 4, 200],
  ["ETH", "unified", 22, 5],
  ["ETH", "transparent", 30, 40],
  ["SOL", "unified", 18, 8],
  ["SOL", "transparent", 9, 70],
  ["NEAR", "transparent", 25, 3],
  ["NEAR", null, 12, 15],
  ["ARB", null, 30, 25],
  ["TRON", "transparent", 10, 25],
  ["DOGE", "unified", 3, 90],
  ["DOGE", "transparent", 5, 120],
  ["BASE", "unified", 2, 300],
  ["XRP", "transparent", 3, 400],
  ["BSC", "unified", 1, 50],
];

/** Every chart window of inbound swaps by chain and family, from `TIP_TIME`. */
export function getDestinationWindows(): DestinationWindows {
  const swapsIn = crossChainTransfers.filter(
    (t) =>
      t.direction === "in" &&
      countsTowardTotals(t) &&
      !SETTLEMENT_ASSETS.includes(t.counterpartAsset),
  );
  const DAY = 86_400;
  const history = DESTINATION_HISTORY.map(([chain, kind, transfers, daysAgo]) => ({
    chain,
    kind,
    transfers,
    timestamp: TIP_TIME - daysAgo * DAY,
  }));
  return {
    asOf: TIP_TIME,
    windows: DESTINATION_WINDOW_DAYS.map((days) => {
      const fromTimestamp = days === null ? null : TIP_TIME - days * DAY;
      const inWindow = (ts: number) => fromTimestamp === null || ts >= fromTimestamp;
      const by = new Map<string, DestinationBucket>();
      const add = (chain: string, kind: DestinationBucket["kind"], n: number, zat: number) => {
        const key = `${chain}:${kind}`;
        const b = by.get(key) ?? { chain, kind, transfers: 0, zat: 0 };
        b.transfers += n;
        b.zat += zat;
        by.set(key, b);
      };
      for (const t of swapsIn) {
        if (!inWindow(t.timestamp)) continue;
        add(t.counterpartChain, classifyZcashAddress(t.zcashAddress), 1, t.zecAmountZat);
      }
      for (const h of history) {
        if (inWindow(h.timestamp)) add(h.chain, h.kind, h.transfers, h.transfers * 250_000_000);
      }
      return { days, fromTimestamp, buckets: [...by.values()] };
    }),
  };
}
