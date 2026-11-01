import type { PlotUnit } from "@/domain/plottable";
import {
  compactCount,
  formatBytes,
  formatCount,
  formatUsd,
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
  }
}

/** An axis tick: a reference line, so only as precise as reading the line needs. */
export function formatPlotTick(unit: PlotUnit, v: number): string {
  switch (unit) {
    case "zat":
      return formatZecTick(v);
    case "count":
    case "difficulty":
      return compactCount(v);
    case "usd":
      return formatUsd(v);
    case "bytes":
      return formatBytes(Math.round(v));
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
  }
}
