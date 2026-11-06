import {
  groupMinersByPool,
  minerValueUsd,
  NO_ADDRESS_GROUP,
  SHIELDED_GROUP,
  UNATTRIBUTED_GROUP,
  type GroupedMiners,
  type MinerSeries,
  type MinersOverview,
  type MinersWindowKey,
  type MinerUsdParts,
} from "@/domain";
import { formatUsd, formatUsdCompact, formatZecTwo, formatZecWhole } from "@/lib/format";
import {
  miningGroupClass,
  miningPoolColourKey,
  OTHER_POOLS_KEY,
  OWN_HUE_POOLS,
} from "@/lib/mining-pool-palette";
import { MINING_POOLS } from "@/domain";

export const WINDOW_LABELS: Record<MinersWindowKey, string> = {
  "7d": "7D",
  "30d": "30D",
  "90d": "90D",
  "1y": "1Y",
  all: "ALL",
};

/** One colour band: a pool with its own hue, "other pools", unattributed, shielded or no address. */
export interface ShareSegment {
  key: string;
  label: string;
  blocks: number;
  className: string;
}

const NAMES: Record<string, string> = {
  [OTHER_POOLS_KEY]: "other pools",
  [UNATTRIBUTED_GROUP]: "unattributed",
  [SHIELDED_GROUP]: "shielded coinbase",
  [NO_ADDRESS_GROUP]: "no address",
};

/** The display name of a colour key. */
export function segmentLabel(key: string): string {
  return NAMES[key] ?? MINING_POOLS[key as keyof typeof MINING_POOLS]?.name ?? key;
}

/** The fixed order bands stack in: hue pools, other pools, then the groups that are not pools. */
export const SEGMENT_ORDER: readonly string[] = [
  ...OWN_HUE_POOLS,
  OTHER_POOLS_KEY,
  UNATTRIBUTED_GROUP,
  NO_ADDRESS_GROUP,
  SHIELDED_GROUP,
];

/**
 * The window's blocks as colour bands, in the fixed order. Pools without a hue of their own, and
 * labelled addresses under a pool id this site does not know, fold into "other pools" (they are
 * pools, by the API's registry); unattributed addresses stay one neutral band.
 */
export function shareSegments(overview: MinersOverview, grouped: GroupedMiners): ShareSegment[] {
  const blocks = new Map<string, number>();
  const add = (key: string, n: number) => blocks.set(key, (blocks.get(key) ?? 0) + n);
  for (const g of grouped.pools) add(miningPoolColourKey(g.pool.id), g.blocks);
  for (const s of grouped.strays) add(OTHER_POOLS_KEY, s.blocks);
  add(UNATTRIBUTED_GROUP, overview.unattributed.blocks);
  add(NO_ADDRESS_GROUP, overview.noAddressBlocks);
  add(SHIELDED_GROUP, overview.shieldedBlocks);
  return SEGMENT_ORDER.filter((k) => (blocks.get(k) ?? 0) > 0).map((key) => ({
    key,
    label: segmentLabel(key),
    blocks: blocks.get(key)!,
    className: miningGroupClass(key),
  }));
}

export function grouped(overview: MinersOverview): GroupedMiners {
  return groupMinersByPool(overview.labelled);
}

/**
 * USD for an amount, valued as `minerValueUsd` values it: "$1.2M", "≥ $1.2M" when some days had
 * no close, or null when it cannot be stated.
 */
export function usdText(
  rewardZat: number | null,
  parts: MinerUsdParts,
  livePriceUsd: number | null,
  compact = false,
): string | null {
  const v = minerValueUsd(rewardZat, parts, livePriceUsd);
  if (v === null) return null;
  return `${v.floor ? "≥ " : ""}${compact ? formatUsdCompact(v.usd) : formatUsd(v.usd)}`;
}

/**
 * A payout amount for a table cell: whole ZEC from 100 up (a pool's month is thousands, and the
 * zatoshis would only widen the column), two decimals below, so a small payout never reads as 0.
 */
export function zecShort(zat: number): string {
  return Math.abs(zat) >= 100 * 1e8 ? formatZecWhole(zat) : formatZecTwo(zat);
}

/** The colour keys a series carries, in stacking order: pools fold by their colour key. */
export function seriesKey(group: string): string {
  if (group === UNATTRIBUTED_GROUP || group === SHIELDED_GROUP || group === NO_ADDRESS_GROUP) {
    return group;
  }
  return miningPoolColourKey(group);
}

/** Blocks per colour key per period, in `SEGMENT_ORDER`, keys with no block dropped. */
export function seriesBands(series: MinerSeries): { key: string; blocks: number[] }[] {
  return SEGMENT_ORDER.map((key) => ({
    key,
    blocks: series.periods.map((p) =>
      series.points
        .filter((x) => x.period === p.period && seriesKey(x.group) === key)
        .reduce((s, x) => s + x.blocks, 0),
    ),
  })).filter((b) => b.blocks.some((v) => v > 0));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Nov 26" for an axis, "Nov 2026" for a readout, from a period's first day. */
export function monthLabel(period: string, long = false): string {
  const m = MONTHS[Number(period.slice(5, 7)) - 1] ?? period;
  return `${m} ${long ? period.slice(0, 4) : period.slice(2, 4)}`;
}

/** "5 Nov" for an axis, "5 Nov 2026" for a readout. */
export function dayLabel(day: string, long = false): string {
  const m = MONTHS[Number(day.slice(5, 7)) - 1] ?? day;
  return `${Number(day.slice(8, 10))} ${m}${long ? ` ${day.slice(0, 4)}` : ""}`;
}
