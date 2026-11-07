import type { Absence, ColumnType, ExportColumn, SourceRow } from "./table";

/**
 * What makes a `/v1` answer exportable: its columns, how its rows are read, and what it can say
 * about its own freshness. One spec per route pattern, registered in `registry.ts`.
 */
export interface ExportSpec {
  /** The file name's stem, and the dataset's name in the JSON form and the descriptor. */
  dataset: string;
  /** Columns may depend on the answer (a floor asked for, a currency), never on anything else. */
  columns: readonly ExportColumn[] | ((body: unknown) => readonly ExportColumn[]);
  rows: (body: unknown) => SourceRow[];
  /**
   * The chain height the rows were read at and the newest UTC day or instant they cover, when the
   * answer states them. Absent fields stay absent: a provenance header is never a guess.
   */
  provenance?: (body: unknown) => { height?: number | null; through?: string | null };
  /** One keyset page of a longer list: the answer's `nextCursor` becomes a `Link` header. */
  paged?: boolean;
  /** Where the answer says it was capped (the daily prices' `truncated`). */
  truncated?: (body: unknown) => boolean;
}

export function columnsOf(spec: ExportSpec, body: unknown): readonly ExportColumn[] {
  return typeof spec.columns === "function" ? spec.columns(body) : spec.columns;
}

export function col(
  name: string,
  type: ColumnType,
  path: string,
  description: string,
  absent?: readonly Absence[],
): ExportColumn {
  return absent === undefined
    ? { name, type, path, description }
    : { name, type, path, description, absent };
}

/**
 * A `{pct, numerator, denominator}` share as three columns: a percentage never travels without
 * its denominator (ARCHITECTURE rule 8).
 */
export function shareColumns(
  prefix: string,
  path: string,
  what: string,
  absent?: readonly Absence[],
): ExportColumn[] {
  return [
    col(
      `${prefix}_pct`,
      "decimal",
      `${path}.pct`,
      `${what}, percent (two decimals).`,
      absent ?? ["nonexistent"],
    ),
    col(
      `${prefix}_numerator`,
      "int",
      `${path}.numerator`,
      `${what}: the count it is a share of.`,
      absent,
    ),
    col(
      `${prefix}_denominator`,
      "int",
      `${path}.denominator`,
      `${what}: the count it is out of.`,
      absent,
    ),
  ];
}

export const PERIOD_START = col(
  "period_start",
  "day",
  "periodStart",
  "First UTC day of the period (a day, or the first day of a month).",
);
