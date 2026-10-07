import type { Transaction } from "@/domain";
import type { TableColumn } from "@/components/DataTable";
import { TxDirection } from "@/components/TxDirection";

/**
 * The column header, defined once and imported by all four list tables so they cannot drift.
 *
 * Spelled out at every width: the narrowest path this column draws (two pool names and an
 * arrow) is wider than the label, so the header never sets the column width.
 *
 * Hidden below `sm`: on a phone the TYPE word beside it already says shielding or unshielding.
 * A header hidden without its cells shifts every row by one, so every `<td>` under it must carry
 * {@link DIRECTION_CELL_CLASS} — or simply be a {@link TxDirectionCell}.
 */
export const DIRECTION_CELL_CLASS = "hidden sm:table-cell";

export const DIRECTION_COLUMN: TableColumn = {
  label: "DIRECTION",
  className: DIRECTION_CELL_CLASS,
};

export interface TxDirectionCellProps {
  tx: Transaction;
  /** Extra cell classes. Not padding — the table sets row height. */
  className?: string;
}

/**
 * The whole DIRECTION cell: the `<td>` (hidden below `sm`, matching the header) and the
 * wrapping row the path lays out in, so the gap between pool names and the gap inside the step
 * cannot disagree across tables.
 */
export function TxDirectionCell({ tx, className = "" }: TxDirectionCellProps) {
  return (
    <td className={`${DIRECTION_CELL_CLASS} ${className}`.trim()}>
      <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
        <TxDirection tx={tx} />
      </span>
    </td>
  );
}
