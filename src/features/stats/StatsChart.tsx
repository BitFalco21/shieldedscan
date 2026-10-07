"use client";

import { useState } from "react";
import type { StatsRange } from "@/domain";
import { DEFAULT_STATS_RANGE, STATS_RANGES } from "@/domain";
import { DataUnavailable } from "@/components/DataUnavailable";
import { MultiLineChart } from "@/components/MultiLineChart";
import { monthShort } from "@/lib/format";

/** A point in whatever the face measures: unix seconds, and one value. */
export interface StatsPoint {
  t: number;
  value: number;
}

export interface StatsChartProps {
  /** Points per window. A window the source could not answer is ABSENT, never empty. */
  windows: Partial<Record<StatsRange, StatsPoint[]>>;
  formatValue: (value: number) => string;
  /** Completes "… over the last seven days" for the accessible name. */
  subject: string;
  seriesName: string;
  /** What to call the thing when a window is missing, e.g. "The 24h price series". */
  unavailableNoun: string;
}

/**
 * One chart for both faces, so the two cannot drift apart in shape or height.
 *
 * The range is client state, never a URL: every window's data is already on the page. The face
 * is a URL (`/stats` and `/stats/shielded`) because it changes what the page claims.
 *
 * Its vocabulary is not the site's `ChartRange`: this is the only page that answers intraday,
 * so it offers 24h and 7d.
 */
export function StatsChart({
  windows,
  formatValue,
  subject,
  seriesName,
  unavailableNoun,
}: StatsChartProps) {
  // Only offer a window the data can answer: a chip that always yields "unavailable" is a dead
  // control.
  const available = STATS_RANGES.filter((r) => windows[r] !== undefined);
  /*
   * The default is a preference, not a guarantee: the shielded face is cut from a daily series
   * and offers no 24h or 7d window, and opening on a missing window would report our own
   * omission as a failed read. It falls back to the shortest window that exists.
   */
  const [range, setRange] = useState<StatsRange>(
    () =>
      (windows[DEFAULT_STATS_RANGE] !== undefined ? DEFAULT_STATS_RANGE : available[0]) ??
      DEFAULT_STATS_RANGE,
  );
  const active = windows[range];

  return (
    <div className="grid gap-3">
      {active === undefined ? (
        <DataUnavailable what={`The ${range} ${unavailableNoun}`} refreshesWithin="15 minutes" />
      ) : (
        <MultiLineChart
          labels={active.map((p) => axisLabel(p.t, range))}
          series={[
            { name: seriesName, values: active.map((p) => p.value), className: "text-green" },
          ]}
          ariaLabel={`${subject} over the last ${spoken(range)}.`}
          formatValue={formatValue}
          /*
           * Neither series has a meaningful ratio to zero: zero-based, a week moving $801 to
           * $837 draws a flat line pinned to the top of the frame. The axis labels carry the
           * real range, which is what keeps a clipped axis honest.
           */
          baseline="data"
        />
      )}
      {available.length > 1 ? (
        <div className="flex flex-wrap gap-1" role="group" aria-label="Range">
          {available.map((r) => (
            <button
              key={r}
              type="button"
              className="stats-range"
              aria-pressed={r === range}
              onClick={() => setRange(r)}
            >
              {r}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The grain of the label follows the grain of the window: a time of day on the intraday
 * ranges, a date on the rest. A 24-hour chart labelled with dates says nothing, and a
 * ten-year chart labelled with clock times says less.
 */
function axisLabel(t: number, range: StatsRange): string {
  const d = new Date(t * 1000);
  if (range === "24h") {
    return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  }
  // A day-and-month up to six months out: with ~8 labels across, 180 days puts one every
  // three weeks, where "Mar 26" still reads and a bare "Mar 26" repeated for every label in
  // a month would not. Past that the year is the thing that distinguishes them.
  if (range === "7d" || range === "30d" || range === "60d" || range === "180d") {
    return `${d.toLocaleString("en-US", { month: "short", timeZone: "UTC" })} ${d.getUTCDate()}`;
  }
  return monthShort(t);
}

function spoken(range: StatsRange): string {
  switch (range) {
    case "24h":
      return "24 hours";
    case "7d":
      return "seven days";
    case "30d":
      return "thirty days";
    case "60d":
      return "sixty days";
    case "180d":
      return "hundred and eighty days";
    case "1y":
      return "year";
    case "all":
      return "whole history";
  }
}
