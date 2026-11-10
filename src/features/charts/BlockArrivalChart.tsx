"use client";

import {
  ARRIVAL_ALL_GROUP,
  arrivalGroupName,
  utcDayFromSeconds,
  type BlockArrivalCell,
  type BlockArrivalSeries,
} from "@/domain";
import { MultiLineChart } from "@/components/MultiLineChart";
import { usePhoneViewport } from "@/lib/use-phone-viewport";
import { formatCount } from "@/lib/format";
import { miningGroupClass, OWN_HUE_POOLS } from "@/lib/mining-pool-palette";
import { RANKED_LINES } from "@/lib/ranked-palette";
import type { ChartTable } from "./chart-table";

export interface BlockArrivalChartProps {
  series: BlockArrivalSeries;
  /** The days to draw, already windowed by the range toggle: the chart-table's own rows. */
  table: ChartTable;
}

/** Whole seconds; a negative age is a miner's clock ahead of ours and prints as such. */
const seconds = (v: number) => `${v < 0 ? "−" : ""}${formatCount(Math.abs(v))} s`;

const columnOf = (t: ChartTable, name: string) => {
  const i = t.columns.indexOf(name);
  return t.rows.map((r) => (i < 0 ? null : (r[i] ?? null)));
};

/**
 * Block age on arrival: the every-block median and 90th percentile per UTC day, each pool's median
 * that day in the readout, then the last 30 days by pool, each a range from its median to its 90th
 * percentile. A day or a pool with too few measured blocks states no figure; it is never zero.
 */
export function BlockArrivalChart({ series, table }: BlockArrivalChartProps) {
  const labels = table.timestamps.map((ts) => utcDayFromSeconds(ts));
  const partial = columnOf(table, "partial");
  const fmt = (v: number | null) => (v === null ? "too few blocks" : seconds(v));
  const poolRows = OWN_HUE_POOLS.map((id) => ({
    name: `${arrivalGroupName(id)} median`,
    values: columnOf(table, `${id}_median_s`).map(fmt),
  }));
  const month = series.windows.find((w) => w.window === "30d") ?? null;
  const phone = usePhoneViewport();

  return (
    <div>
      <MultiLineChart
        labels={labels}
        readoutLabels={labels.map((l, i) => (partial[i] === 1 ? `${l}, so far` : l))}
        series={[
          { name: "Median", values: columnOf(table, "median_s"), className: RANKED_LINES[0] },
          {
            name: "90th percentile",
            values: columnOf(table, "p90_s"),
            className: RANKED_LINES[0],
            dashed: true,
          },
        ]}
        formatValue={seconds}
        formatTick={seconds}
        phone={phone}
        ariaLabel="Median and 90th-percentile age of each day's blocks, by their header timestamp, when this explorer's node stored them"
        contextRows={[
          {
            name: "Blocks measured",
            values: columnOf(table, "measured").map((v) => formatCount(v ?? 0)),
          },
          {
            name: "Stored late, left out",
            values: columnOf(table, "late").map((v) => formatCount(v ?? 0)),
          },
          ...poolRows,
        ]}
      />

      {month === null ? null : <PoolRanges window={month} />}

      <p className="mt-3 max-w-3xl text-xs leading-relaxed text-ink-faint">
        From a block&apos;s header timestamp to our node storing it, since{" "}
        {series.recordingSince ?? "recording began"}. Not clock skew: the miner&apos;s timestamp
        lag, propagation and our own 5 to 10 seconds add up.
      </p>
    </div>
  );
}

/** The last 30 days by pool: a bar from the median to the 90th percentile, on one scale. */
function PoolRanges({ window }: { window: BlockArrivalSeries["windows"][number] }) {
  const measured = window.groups.filter(
    (g): g is BlockArrivalCell & { p50Seconds: number; p90Seconds: number } =>
      g.p50Seconds !== null && g.p90Seconds !== null,
  );
  const thin = window.groups.filter((g) => g.p50Seconds === null);
  const lo = Math.min(0, ...measured.map((g) => g.p50Seconds));
  const hi = Math.max(1, ...measured.map((g) => g.p90Seconds));
  const at = (v: number) => `${(((v - lo) / (hi - lo)) * 100).toFixed(2)}%`;
  const span = (a: number, b: number) =>
    `${Math.max(0.6, ((b - a) / (hi - lo)) * 100).toFixed(2)}%`;

  return (
    <section className="mt-6" aria-label="Block age on arrival by mining pool, last 30 days">
      <h3 className="microlabel mb-3 text-ink-dim">
        last 30 days by pool · {window.fromDay} to {window.toDay}
      </h3>
      <ul className="grid gap-2.5 text-xs">
        {measured.map((g) => (
          <li
            key={g.group}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 sm:grid-cols-[10rem_minmax(0,1fr)_14rem]"
          >
            <span className="min-w-0 truncate text-ink-bright">
              {arrivalGroupName(g.group)}
              <span className="text-ink-faint tabular-nums sm:hidden">
                {" "}
                · {formatCount(g.measured)}
              </span>
            </span>
            <span className="text-right whitespace-nowrap tabular-nums sm:order-3">
              {seconds(g.p50Seconds)}
              <span className="text-ink-faint"> · p90 {seconds(g.p90Seconds)}</span>
              <span className="hidden text-ink-faint sm:inline">
                {" "}
                · {formatCount(g.measured)} blocks
              </span>
            </span>
            <span
              className={`col-span-2 sm:order-2 sm:col-span-1 ${g.group === ARRIVAL_ALL_GROUP ? "text-green" : miningGroupClass(g.group)}`}
              aria-hidden
            >
              <svg width="100%" height="10" focusable="false" className="block">
                <rect className="fill-ink-faint opacity-20" width="100%" height="10" />
                <rect
                  className="fill-current opacity-45"
                  x={at(g.p50Seconds)}
                  width={span(g.p50Seconds, g.p90Seconds)}
                  height="10"
                />
                <rect className="fill-current" x={at(g.p50Seconds)} width="3" height="10" />
              </svg>
            </span>
          </li>
        ))}
      </ul>
      {thin.length === 0 ? null : (
        <p className="mt-2.5 text-xs text-ink-faint">
          Too few blocks to state ({"<"} 10 measured):{" "}
          {thin.map((g) => `${arrivalGroupName(g.group)} (${formatCount(g.measured)})`).join(", ")}.
        </p>
      )}
    </section>
  );
}
