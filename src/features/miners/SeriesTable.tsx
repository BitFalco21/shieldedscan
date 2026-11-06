import { DataTable } from "@/components/DataTable";

export interface SeriesTableProps {
  caption: string;
  /** The first column's heading: the period. */
  period: string;
  columns: string[];
  rows: { label: string; cells: string[] }[];
}

/**
 * A chart's numbers as a table, behind a disclosure under it: the same figures the bars draw, for
 * a screen reader, a copy, or a reader who wants the values without hovering.
 */
export function SeriesTable({ caption, period, columns, rows }: SeriesTableProps) {
  return (
    <details className="mt-3 text-xs">
      <summary className="cursor-pointer text-ink-faint hover:text-green">table</summary>
      <div className="mt-2">
        <DataTable
          caption={caption}
          density="compact"
          bounded
          columns={[
            { label: period },
            ...columns.map((label) => ({ label, align: "right" as const })),
          ]}
        >
          {rows.map((r) => (
            <tr key={r.label} className="hairline-b last:border-0">
              <td className="whitespace-nowrap">{r.label}</td>
              {r.cells.map((c, i) => (
                <td key={columns[i]} className="text-right whitespace-nowrap tabular-nums">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </DataTable>
      </div>
    </details>
  );
}
