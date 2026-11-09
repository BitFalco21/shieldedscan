"use client";

import { blockSharePct, MAJORITY_PCT, poolsToMajority, type MinerSeries } from "@/domain";
import { StackedBarChart } from "@/components/StackedBarChart";
import { formatCount, formatSharePct } from "@/lib/format";
import { SeriesTable } from "./SeriesTable";
import { monthLabel } from "./miners-view";

export interface PoolsToMajorityChartProps {
  series: MinerSeries;
  /** The numbers as a table under the bars: on `/miners`, where every chart carries one. */
  withTable?: boolean;
}

/** A month with no count draws no bar: below zero, so the chart skips it and the readout says why. */
const NO_COUNT = -1;

/** A count axis labels whole numbers only: "1.5 pools" is not a quantity. */
const wholeTick = (v: number) => (Number.isInteger(v) ? formatCount(v) : "");

/**
 * How many reviewed pools, largest first, mined 51% of each month's blocks. The count is a maximum:
 * the unattributed, shielded-coinbase and unrecorded blocks stay in the denominator, and naming any
 * of them could only lower it. A month where every reviewed pool together mined less has no bar,
 * and its readout states the reviewed share it fell short with rather than a number of pools.
 */
export function PoolsToMajorityChart({ series, withTable = false }: PoolsToMajorityChartProps) {
  const months = poolsToMajority(series);
  const running = months.findIndex((m) => m.partial);
  const pct = (blocks: number, of: number) => {
    const p = blockSharePct(blocks, of);
    return p === null ? "—" : formatSharePct(p);
  };
  const count = (v: number) =>
    v === NO_COUNT ? `none: reviewed pools under ${MAJORITY_PCT}%` : formatCount(v);
  return (
    <div>
      <StackedBarChart
        series={[
          {
            key: "pools",
            label: `Pools to ${MAJORITY_PCT}%`,
            colorClass: "text-series",
            values: months.map((m) => m.pools ?? NO_COUNT),
          },
        ]}
        labels={months.map((m) => monthLabel(m.period))}
        readoutLabels={months.map((m) => monthLabel(m.period, true))}
        ariaLabel={`How many reviewed mining pools, largest first, mined ${MAJORITY_PCT}% of each month's blocks`}
        formatValue={count}
        formatTick={wholeTick}
        partial={running < 0 ? null : { index: running, note: "so far" }}
        readout="total"
        totalLabel={`Pools to ${MAJORITY_PCT}%`}
        contextRows={[
          { name: "Largest pool", values: months.map((m) => pct(m.top1Blocks, m.blocks)) },
          { name: "Largest 3", values: months.map((m) => pct(m.top3Blocks, m.blocks)) },
          { name: "All reviewed", values: months.map((m) => pct(m.reviewedBlocks, m.blocks)) },
          { name: "Blocks", values: months.map((m) => formatCount(m.blocks)) },
        ]}
      />
      {withTable ? (
        <SeriesTable
          caption={`Reviewed pools needed for ${MAJORITY_PCT}% of each month's blocks`}
          period="MONTH"
          columns={["POOLS", "LARGEST", "LARGEST 3", "ALL REVIEWED"]}
          rows={months.map((m) => ({
            label: monthLabel(m.period, true) + (m.partial ? " (so far)" : ""),
            cells: [
              m.pools === null ? "none" : formatCount(m.pools),
              pct(m.top1Blocks, m.blocks),
              pct(m.top3Blocks, m.blocks),
              pct(m.reviewedBlocks, m.blocks),
            ],
          }))}
        />
      ) : null}
    </div>
  );
}
