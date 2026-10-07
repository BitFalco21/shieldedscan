import type { PriceSeries, Stats, StatsRange } from "@/domain";
import { marketCapFromTermsUsd, STATS_RANGES } from "@/domain";
import { Unmeasured } from "@/components/Unmeasured";
import { formatDeltaPct, formatUsdCompact, formatUsdExact, formatZecWhole } from "@/lib/format";
import { DeltaArrow } from "./DeltaArrow";
import { StatFigure } from "./StatFigure";
import { StatsChart, type StatsPoint } from "./StatsChart";

export interface PriceFaceProps {
  stats: Stats;
  series: Partial<Record<StatsRange, PriceSeries>>;
}

/** The venue answers each window at its own candle grain, so they arrive already windowed. */
function priceWindows(
  series: Partial<Record<StatsRange, PriceSeries>>,
): Partial<Record<StatsRange, StatsPoint[]>> {
  const out: Partial<Record<StatsRange, StatsPoint[]>> = {};
  for (const range of STATS_RANGES) {
    const entry = series[range];
    if (entry !== undefined) out[range] = entry.points.map((p) => ({ t: p.t, value: p.usd }));
  }
  return out;
}

export function PriceFace({ stats, series }: PriceFaceProps) {
  const { priceUsd, changeTodayPct } = stats;
  const marketCapUsd =
    priceUsd === null ? null : marketCapFromTermsUsd(stats.shielded.circulatingSupplyZat, priceUsd);

  return (
    <div className="grid gap-5">
      <p className="microlabel">
        <span className="text-green-dim">zec</span> <span>spot · usd</span>
      </p>

      <StatFigure
        sigil={priceUsd === null ? undefined : "$"}
        value={priceUsd === null ? <Unmeasured /> : formatUsdExact(priceUsd).replace("$", "")}
      />

      <div className="flex flex-wrap items-center gap-3">
        {/*
         * "today", never "24h": the venue publishes its UTC open and no 24-hours-ago price,
         * so this is the change since midnight UTC.
         */}
        {changeTodayPct === null ? null : (
          <span className={changeTodayPct < 0 ? "stats-pill stats-pill-neg" : "stats-pill"}>
            <DeltaArrow change={changeTodayPct} />
            {formatDeltaPct(changeTodayPct)} <span className="text-ink-faint">·</span> today
          </span>
        )}
        {marketCapUsd === null ? null : (
          <span className="microlabel">
            mkt cap {formatUsdCompact(marketCapUsd)} · supply{" "}
            {formatZecWhole(stats.shielded.circulatingSupplyZat)}
          </span>
        )}
      </div>

      <StatsChart
        windows={priceWindows(series)}
        formatValue={formatUsdExact}
        subject="ZEC price"
        seriesName="ZEC"
        unavailableNoun="price series"
      />
    </div>
  );
}
