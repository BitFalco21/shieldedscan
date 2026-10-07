import { PANEL_PADDING } from "@/components/Panel";

export interface TableSkeletonProps {
  /** Number of columns in the real table this stands in for. */
  columns: number;
  /** Number of placeholder rows to render. */
  rows: number;
}

/**
 * Table-shaped stand-in for a `<Panel><DataTable/></Panel>` list, rendered by a route's
 * `loading.tsx` while the data port resolves. Uses the `panel` + `animate-pulse` vocabulary,
 * shaped like the table that is actually arriving.
 */
export function TableSkeleton({ columns, rows }: TableSkeletonProps) {
  const columnIndexes = Array.from({ length: columns }, (_, i) => i);
  const rowIndexes = Array.from({ length: rows }, (_, i) => i);

  return (
    // The Panel's regular density, read from Panel itself, so the page does not jump when the
    // real table replaces this.
    <div className={`panel ${PANEL_PADDING.regular}`} aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>
      <div className="hairline-b flex gap-4 pb-3">
        {columnIndexes.map((c) => (
          <div key={c} className="h-3 flex-1 animate-pulse rounded-sm bg-green-faint/60" />
        ))}
      </div>
      {rowIndexes.map((r) => (
        <div key={r} className="hairline-b flex gap-4 py-3 last:border-0">
          {columnIndexes.map((c) => (
            <div key={c} className="h-4 flex-1 animate-pulse rounded-sm bg-green-faint/30" />
          ))}
        </div>
      ))}
    </div>
  );
}
