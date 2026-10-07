import type { ShieldedSupplyPoint, Stats, StatsRange } from "@/domain";
import { shieldedShareOfCirculatingPct, STATS_RANGES, DAY_SECONDS } from "@/domain";
import { formatSharePct, formatZecWhole } from "@/lib/format";
import { DeltaArrow } from "./DeltaArrow";
import { StatFigure } from "./StatFigure";
import { StatsChart, type StatsPoint } from "./StatsChart";

export interface ShieldedFaceProps {
  stats: Stats;
  /** The shielded-supply history, all of it — the windows below are cut from this one series. */
  supply: ShieldedSupplyPoint[];
}

/**
 * Windows cut from ONE daily series, unlike the price face, whose venue answers each window
 * at its own candle grain. A 24-hour window of a DAILY series is one point, which draws
 * nothing — so the short windows are omitted rather than rendered as a dot, and the chips
 * for them do not appear. That is the dead-control rule, applied to a range.
 */
const WINDOW_SECONDS: Partial<Record<StatsRange, number>> = {
  "30d": 30 * DAY_SECONDS,
  "60d": 60 * DAY_SECONDS,
  "180d": 180 * DAY_SECONDS,
  "1y": 365 * DAY_SECONDS,
};

export function supplyWindows(
  points: ShieldedSupplyPoint[],
): Partial<Record<StatsRange, StatsPoint[]>> {
  if (points.length < 2) return {};
  const out: Partial<Record<StatsRange, StatsPoint[]>> = {};
  const all = points.map((p) => ({ t: p.timestamp, value: p.totalZat }));
  // Anchored on the series' own last point, never `Date.now()`: the server renders and the
  // client hydrates at different instants, and a clock-anchored cut selects different points
  // on each — a hydration mismatch.
  const newest = all[all.length - 1]!.t;
  for (const range of STATS_RANGES) {
    const span = WINDOW_SECONDS[range];
    if (span === undefined) continue;
    const window = all.filter((p) => p.t >= newest - span);
    if (window.length > 1) out[range] = window;
  }
  out.all = all;
  return out;
}

/**
 * The shielded face.
 *
 * The headline share comes from `shieldedShareOfCirculatingPct` in `domain/pool.ts`, the same
 * function the homepage and `/shielded` publish, so the pages cannot disagree.
 */
export function ShieldedFace({ stats, supply }: ShieldedFaceProps) {
  const { totalShieldedZat, circulatingSupplyZat, netShieldedTodayZat } = stats.shielded;
  const share = shieldedShareOfCirculatingPct(totalShieldedZat, circulatingSupplyZat);

  return (
    <div className="grid gap-5">
      <p className="microlabel">
        {/* A percentage never appears here without naming what it is a percentage of. */}
        <span className="text-green-dim">
          {share === null ? "—" : formatSharePct(share, 2)}
        </span>{" "}
        <span>of circulating supply is shielded</span>
      </p>

      <StatFigure value={formatZecWhole(totalShieldedZat).replace(" ZEC", "")} unit="zec" />

      <div className="flex flex-wrap items-center gap-3">
        {netShieldedTodayZat === null ? null : (
          <span className={netShieldedTodayZat < 0 ? "stats-pill stats-pill-neg" : "stats-pill"}>
            <DeltaArrow change={netShieldedTodayZat} />
            {formatZecWhole(Math.abs(netShieldedTodayZat))}{" "}
            <span className="text-ink-faint">·</span> net shielded, today
          </span>
        )}
        <span className="microlabel">
          {formatZecWhole(totalShieldedZat)} of {formatZecWhole(circulatingSupplyZat)}
        </span>
      </div>

      <StatsChart
        windows={supplyWindows(supply)}
        formatValue={formatZecWhole}
        subject="Total shielded supply"
        seriesName="Shielded"
        unavailableNoun="shielded supply series"
      />
    </div>
  );
}
