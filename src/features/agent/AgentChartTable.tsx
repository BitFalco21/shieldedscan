import { chartSeries, type PlottedChart } from "@/domain";
import { DataTable } from "@/components/DataTable";
import { formatCount } from "@/lib/format";
import { formatPlotExact } from "@/lib/plot-format";
import { readoutLabel } from "./chart-view";

/** Rows the table shows, newest kept: a year of days, and every week or month a chart can hold. */
export const MAX_TABLE_ROWS = 366;

export interface AgentChartTableProps {
  chart: PlottedChart;
  /** The chart's caption, which names the table for a screen reader. */
  caption: string;
}

/**
 * The chart's values as a table: the same numbers the lines draw, exact, for a reader who cannot
 * see the chart or wants the figure behind a point. A floor is marked `≥` and an unmeasured period
 * reads "—", as the readout does. A long daily series shows its newest year and says so.
 */
export function AgentChartTable({ chart, caption }: AgentChartTableProps) {
  const series = chartSeries(chart);
  const total = chart.timestamps.length;
  const first = Math.max(0, total - MAX_TABLE_ROWS);
  const rows = chart.timestamps.slice(first).map((t, k) => ({ t, i: first + k }));

  return (
    <div className="mt-2">
      {first > 0 && (
        <p className="mb-2 text-xs text-ink-faint">
          The latest {formatCount(rows.length)} of {formatCount(total)} periods.
        </p>
      )}
      <DataTable
        caption={caption}
        density="compact"
        columns={[
          { label: "Period" },
          ...series.map((s) => ({ label: s.label, align: "right" as const })),
        ]}
      >
        {rows.map(({ t, i }) => (
          <tr key={t}>
            <td className="whitespace-nowrap">{readoutLabel(chart.grain, t)}</td>
            {chart.series.map((s, j) => {
              const v = s.values[i] ?? null;
              return (
                <td key={s.id} className="text-right tabular-nums">
                  {v === null
                    ? "—"
                    : `${s.floors.includes(i) ? "≥ " : ""}${formatPlotExact(series[j]!.unit, v)}`}
                </td>
              );
            })}
          </tr>
        ))}
      </DataTable>
    </div>
  );
}
