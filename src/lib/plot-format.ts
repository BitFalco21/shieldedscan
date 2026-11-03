import type { PlotUnit } from "@/domain/plottable";
import {
  compactCountTick,
  formatBytes,
  formatCount,
  formatSharePct,
  formatShareTick,
  formatUsd,
  formatUsdTick,
  formatUsdExact,
  formatZec,
  formatZecCompact,
  formatZecTick,
} from "./format";

/**
 * How a plotted value reads, by unit: the hover readout, the axis ticks, and the exact form for a
 * table or a sentence. One table, used by the console and by the summary the agent is handed, so
 * the figure Zeno quotes is spelled the way the chart beside it spells it.
 */

const wholeDifficulty = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 });

/** The readout beside the cursor. */
export function formatPlotValue(unit: PlotUnit, v: number): string {
  switch (unit) {
    case "zat":
      return formatZecCompact(v);
    case "count":
      return formatCount(Math.round(v));
    case "usd":
      return formatUsd(v);
    case "difficulty":
      return wholeDifficulty(v);
    case "bytes":
      return formatBytes(Math.round(v));
    case "pct":
      return formatSharePct(v);
  }
}

/**
 * An axis tick: a reference line, so only as precise as reading the line needs, and exact at the
 * round values the axis steps by. Bytes print as bytes: the axis steps in tens, and in 1,024-byte
 * kB a 2,000-byte line would read "1.95 kB", or wrongly "2.0 kB".
 */
export function formatPlotTick(unit: PlotUnit, v: number): string {
  switch (unit) {
    case "zat":
      return formatZecTick(v);
    case "count":
    case "difficulty":
      return compactCountTick(v);
    case "usd":
      return formatUsdTick(v);
    case "bytes":
      return Number.isInteger(v) ? `${formatCount(v)} B` : "";
    case "pct":
      return formatShareTick(v);
  }
}

/** The exact figure, for the table view and the sentence the agent writes. */
export function formatPlotExact(unit: PlotUnit, v: number): string {
  switch (unit) {
    case "zat":
      return formatZec(v);
    case "count":
      return formatCount(v);
    case "usd":
      return formatUsdExact(v);
    case "difficulty":
      return wholeDifficulty(v);
    case "bytes":
      return formatBytes(Math.round(v));
    case "pct":
      return formatSharePct(v, 2);
  }
}
