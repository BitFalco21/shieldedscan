"use client";

import type { OrphanRateSeries, OrphanRateWindow } from "@/domain";
import { ORPHAN_RATE_DAYS, orphanRatePct, utcDayFromSeconds } from "@/domain";
import { StackedBarChart } from "@/components/StackedBarChart";
import { StatCard } from "@/components/StatCard";
import { StatGrid } from "@/components/StatGrid";
import { formatCount, formatSharePct, formatShareTick, formatUtc } from "@/lib/format";

export interface OrphanRateChartProps {
  series: OrphanRateSeries;
}

const DAY = 86_400;

/** A day with no canonical block: no bar, and the readout says so rather than 0%. */
const NO_BLOCKS = -1;

/** Rates run to fractions of a percent, so two decimals; below that grain, "<0.01%". */
const rate = (v: number) => (v < 0 ? "no blocks" : formatSharePct(v, 2));

/** "11-08 13:00": a span's end, the year implied by the page. */
const dayTime = (ts: number) => formatUtc(ts).slice(5, 16);

const plural = (n: number, one: string) => `${formatCount(n)} ${one}${n === 1 ? "" : "s"}`;

function windowLabel(key: OrphanRateWindow["key"], upgrade: string): string {
  switch (key) {
    case "24h":
      return "LAST 24 HOURS";
    case "7d":
      return "LAST 7 DAYS";
    case "30d":
      return "LAST 30 DAYS";
    case "before-upgrade":
      return `BEFORE ${upgrade}`;
    case "since-upgrade":
      return `SINCE ${upgrade}`;
  }
}

/** The span a tile covers, where its label alone would overstate it. */
function windowSpan(w: OrphanRateWindow, asOf: number): string | null {
  if (w.firstBlockAt === null || w.lastBlockAt === null) return null;
  if (w.key === "24h") return `${dayTime(w.firstBlockAt)} – ${dayTime(w.lastBlockAt)} UTC`;
  if (w.key === "7d" || w.key === "30d") {
    // Shorter than its label only when observation began inside it.
    const nominal = asOf - (w.key === "7d" ? 7 : 30) * DAY;
    return w.firstBlockAt > nominal + 3_600 ? `from ${utcDayFromSeconds(w.firstBlockAt)}` : null;
  }
  return `from ${utcDayFromSeconds(w.firstBlockAt)}`;
}

/**
 * The observed orphan rate: one bar per UTC day over the last sixty, then the standing windows,
 * each with the counts it is made of. A day before observation began is empty space, never a bar
 * of zero; a day with no orphan is a measured 0%.
 */
export function OrphanRateChart({ series }: OrphanRateChartProps) {
  const { days, windows, upgrade, asOf } = series;
  const values = days.map((d) => orphanRatePct(d) ?? NO_BLOCKS);
  const today = days.findIndex((d) => d.partial && d.timestamp + DAY > asOf);
  const at = upgrade?.activatedAt ?? null;
  const markerIndex =
    at === null ? -1 : days.findIndex((d) => at >= d.timestamp && at < d.timestamp + DAY);
  const readoutLabels = days.map((d, i) => {
    const day = utcDayFromSeconds(d.timestamp);
    if (i === today) return `${day}, so far`;
    if (d.partial) return `${day}, from ${formatUtc(series.observingSince).slice(11)}`;
    return day;
  });
  const unobserved = ORPHAN_RATE_DAYS - days.length;

  return (
    <div>
      <StackedBarChart
        series={[{ key: "rate", label: "Orphan rate", colorClass: "text-series", values }]}
        labels={days.map((d) => utcDayFromSeconds(d.timestamp))}
        readoutLabels={readoutLabels}
        ariaLabel="Orphaned blocks as a share of canonical blocks each UTC day, as this explorer's node observed them"
        formatValue={rate}
        formatTick={formatShareTick}
        partial={today < 0 ? null : { index: today, note: "so far" }}
        marker={
          markerIndex < 0 || upgrade === null ? null : { index: markerIndex, label: upgrade.name }
        }
        before={unobserved > 0 ? { slots: unobserved, note: "not yet observed" } : null}
        readout="total"
        totalLabel="Orphan rate"
        contextRows={[
          { name: "Orphans", values: days.map((d) => formatCount(d.orphans)) },
          { name: "Blocks", values: days.map((d) => formatCount(d.blocks)) },
        ]}
      />

      <StatGrid columns={5} className="mt-4">
        {windows.map((w) => {
          const pct = orphanRatePct(w);
          const span = windowSpan(w, asOf);
          return (
            <StatCard
              key={w.key}
              label={windowLabel(w.key, upgrade?.name ?? "")}
              value={
                pct === null ? (
                  <span className="text-ink-faint">no blocks</span>
                ) : (
                  formatSharePct(pct, 2)
                )
              }
              sub={
                <>
                  {plural(w.orphans, "orphan")} · {plural(w.blocks, "block")}
                  {span ? (
                    <>
                      <br />
                      {span}
                    </>
                  ) : null}
                </>
              }
            />
          );
        })}
      </StatGrid>

      <p className="mt-3 max-w-3xl text-xs leading-relaxed text-ink-faint">
        As seen by this explorer&apos;s node: a competing block it never received is not counted, so
        the network&apos;s rate can only be higher. Each orphan falls on the day of the block it
        competed with, by header time (UTC).
      </p>
    </div>
  );
}
