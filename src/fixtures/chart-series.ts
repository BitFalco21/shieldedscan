import type {
  BlocksDayPoint,
  ChainInflowPoint,
  ChainOutflowPoint,
  InflowKindMonthPoint,
  SupplyDayPoint,
  VenueMonthPoint,
  MinerShareMonth,
  NoteTreeDayPoint,
  ReorgWeekSeries,
  TransparentDayPoint,
} from "@/domain";
import { classifyZcashAddress } from "@/domain/address";
import { SETTLEMENT_ASSETS } from "@/domain/crosschain";
import { crossChainTransfers } from "./crosschain";
import { getDailySeries, getMonthlySeries, getReorgSummary, listReorgEvents } from "./index";

/**
 * Sample series for the chart library's newer charts, each derived from the fixtures that
 * already exist so that, in fixture mode, one page never shows two stories: transparent activity from the sample transparent counts, and so on.
 */

const DAY = 86_400;

/** Sapling from its 2018 activation, Orchard from 2022, Ironwood over the last weeks. */
export function getNoteTrees(): NoteTreeDayPoint[] {
  const days = getDailySeries();
  const first = days[0]?.timestamp ?? 0;
  return days.map((d, i) => ({
    timestamp: d.timestamp,
    saplingNotes: 73_000_000 + i * 2_700,
    orchardNotes: 49_500_000 + i * 2_600,
    ironwoodNotes: d.timestamp - first >= 300 * DAY ? (i - 300) * 9_000 + 4_000 : null,
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
