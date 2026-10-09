import {
  readinessHistory,
  type NetReleases,
  type NetworkUpgrade,
  type ReadinessDay,
  type UpgradeRelease,
} from "@/domain";
import type { MultiLineChartProps } from "@/components/MultiLineChart";
import { formatCount } from "@/lib/format";

/** Dots on each day while the record is short enough that each day is worth seeing. */
const MARKER_DAYS = 45;

/** "Oct 3": the axis names days the way a reader does; the readout keeps the full date. */
function dayLabel(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

const pct = (part: number, whole: number) => (whole === 0 ? null : (100 * part) / whole);

/**
 * The readiness trend, one configuration for both places it is drawn: the upgrade tab and the
 * chart library. Every share names its denominator in the readout (the nodes answering), and
 * "behind" is a share of the nodes whose height could be compared, not of all answering.
 *
 * Null with fewer than two recorded days: a line needs two points, and the caller says why.
 */
export function readinessChart(
  releases: NetReleases,
  upgrade: NetworkUpgrade,
  upgradeReleases: readonly UpgradeRelease[],
): { days: ReadinessDay[]; chart: MultiLineChartProps } | { days: ReadinessDay[]; chart: null } {
  const days = readinessHistory(releases.history, upgrade, "mainnet", upgradeReleases);
  const first = days[0];
  if (!first || days.length < 2) return { days, chart: null };
  return {
    days,
    chart: {
      labels: days.map((d) => dayLabel(d.day)),
      readoutLabels: days.map((d) => d.day),
      series: [
        {
          name: "Ready",
          values: days.map((d) => pct(d.ready, d.answering)),
          className: "text-green",
        },
        {
          name: `Declare ${upgrade.minProtocolVersion.mainnet}+`,
          values: days.map((d) => pct(d.ready + d.declares, d.answering)),
          className: "text-green-dim",
        },
        {
          name: "Behind our tip",
          values: days.map((d) => pct(d.behindTip, d.tipKnown)),
          className: "text-series",
        },
      ],
      formatValue: (v) => `${v.toFixed(1)}%`,
      yMax: 100,
      markers: days.length <= MARKER_DAYS,
      contextRows: [{ name: "Answering", values: days.map((d) => formatCount(d.answering)) }],
      ariaLabel: `Share of answering nodes ready for ${upgrade.name}, declaring its protocol version, and behind our tip, by day since ${first.day}`,
    },
  };
}
