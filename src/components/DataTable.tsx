import type { ReactNode } from "react";
import { FlushEnd } from "@/components/FlushEnd";

export interface TableColumn {
  /**
   * `ReactNode`, not `string`, so a header can hide its word at a breakpoint while keeping
   * it in the accessibility tree — a column whose label is wider than its cells sets the
   * column width, which can overflow a phone.
   */
  label: ReactNode;
  align?: "right";
  /**
   * A control rendered beside the label — a filter, in practice. Sits in the header rather
   * than above the table so it is attached to the column it acts on; a chip row detached
   * from its column has to be read twice to know what it filters.
   */
  control?: ReactNode;
  /**
   * Extra classes for this column's header cell — in practice `hidden sm:table-cell`, to
   * drop a column on a phone. The matching `<td>` must carry the same classes: a table has
   * no way to hide a column from one place, and a header hidden without its cells shifts
   * every row by one.
   */
  className?: string;
}

export interface DataTableProps {
  /** Accessible name for the table, announced by screen readers but not shown. */
  caption: string;
  columns: TableColumn[];
  /**
   * Row height, set once for the table (`.data-table` in `app/styles/components.css`): `regular` for a list a
   * reader scans, `compact` for a dense secondary table. Cells should not carry their own
   * `py-*`, so two tables on one page cannot disagree.
   */
  density?: "regular" | "compact";
  children: ReactNode;
}

/**
 * Shared chrome for the list pages: scroll wrapper, table element and header row.
 * Callers render their own <tr> rows as children — cell markup stays where it is
 * readable.
 *
 * It lives inside a `Panel`: the header row is painted the panel colour (so rows scroll
 * under it) and the edge columns are flush with the panel's padding. `e2e/layout.spec.ts`
 * fails on a `.data-table` with no `.panel` ancestor.
 *
 * Scroll behaviour differs per breakpoint, because `position: sticky` resolves against the
 * nearest scroll-container ancestor:
 *
 * - Below `lg` the wrapper sets `overflow-x-auto`, so a wide table scrolls sideways inside
 *   its panel instead of scrolling the whole page. That makes the wrapper a scrollport, so
 *   the header does not stick — the lesser cost.
 * - From `lg` up, overflow returns to `visible`, so the header sticks against the page and
 *   the column labels stay in view with a single page scrollbar. A table must therefore fit
 *   its panel from `lg` — `e2e/layout.spec.ts` measures it.
 *
 * Bounding this wrapper's height and scrolling internally is rejected: it nests a scroll
 * region inside the page, with two scrollbars and the pagination stranded outside it.
 */
export function DataTable({ caption, columns, density = "regular", children }: DataTableProps) {
  return (
    <div className="overflow-x-auto lg:overflow-x-visible">
      <table
        // An array join, never a template literal with a conditional fragment: prettier's
        // Tailwind plugin trims the leading space inside the fragment and fuses two classes.
        className={["data-table w-full text-sm", density === "compact" ? "data-table-compact" : ""]
          .filter(Boolean)
          .join(" ")}
      >
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="table-head-sticky microlabel text-left">
            {columns.map((column, index) => (
              <th
                // Index key: `label` is a node, and column order is fixed for the table's life.
                key={index}
                scope="col"
                className={`border-b border-edge-faint pb-2 font-normal ${column.align === "right" ? "text-right" : ""} ${column.className ?? ""}`}
              >
                {column.control === undefined ? (
                  column.align === "right" ? (
                    <FlushEnd>{column.label}</FlushEnd>
                  ) : (
                    column.label
                  )
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    {column.label}
                    {column.control}
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
