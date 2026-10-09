import type {
  BlocksDayPoint,
  ChainInflowPoint,
  FeeKindMonthPoint,
  FeeSpreadKind,
  FeeSpreadPoint,
  FeeSpreadSeries,
  MinerShareMonth,
  NoteTreeDayPoint,
  ReorgWeekSeries,
  TransparentDayPoint,
} from "@/domain";
import { SETTLEMENT_ASSETS } from "@/domain/crosschain";
import { crossChainTransfers } from "./crosschain";
import {
  getDailySeries,
  getFeeDistribution,
  getFeeKindsDaily,
  getMonthlySeries,
  getReorgSummary,
  listReorgEvents,
} from "./index";

/**
 * Sample series for the chart library's newer charts, each derived from the fixtures that
 * already exist so that, in fixture mode, one page never shows two stories: fee percentiles from
 * the sample medians, transparent activity from the sample transparent counts, and so on.
 */

const DAY = 86_400;

function spreadOf(median: number | null, txs: number): FeeSpreadKind | null {
  if (median === null) return null;
  return {
    p25Zat: Math.round(median * 0.8),
    medianZat: median,
    p75Zat: Math.round(median * 1.6),
    txs,
  };
}

function spreadPoints(medians: FeeKindMonthPoint[], txs: number): FeeSpreadPoint[] {
  return medians.map((m) => ({
    timestamp: m.timestamp,
    transparent: spreadOf(m.transparentZat, txs),
    mixed: spreadOf(m.mixedZat, Math.round(txs / 3)),
    shielded: spreadOf(m.shieldedZat, Math.round(txs / 2)),
  }));
}

export function getFeeSpread(): FeeSpreadSeries {
  return {
    monthly: spreadPoints(getFeeDistribution().monthly, 120_000),
    daily: spreadPoints(getFeeKindsDaily(), 4_000),
  };
}

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
