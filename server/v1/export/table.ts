import { utcDayFromSeconds } from "@/domain/time";
import { plainNumber } from "./csv";

/**
 * An export is a table: declared columns, rows read off an answer the route already built, and
 * the reason behind every empty cell.
 *
 * Columns are declared, never inferred from the answer, so a field added to the JSON cannot add a
 * column to a file someone's script parses, and an empty answer still has its header. Each column
 * names its unit in its name (`_zat`, `_utc`, `period_start`) and the reasons it may be empty.
 */

/** The closed vocabulary of `/v1`'s `unknowns` map. */
export type Absence = "shielded" | "unmeasured" | "omitted" | "nonexistent" | "indeterminate";

export type ColumnType =
  /** An integer count, height or size. */
  | "int"
  /** Integer zatoshi. */
  | "zat"
  /** A decimal: a float the API publishes (difficulty), or an exact decimal string (fiat). */
  | "decimal"
  /** A UTC day, `YYYY-MM-DD`; unix seconds at a day's start are converted. */
  | "day"
  /** A UTC instant, ISO 8601 with `Z`, converted from unix seconds. */
  | "utc"
  | "text"
  | "bool";

export interface ExportColumn {
  name: string;
  type: ColumnType;
  /** Dotted path to the value inside one row object. */
  path: string;
  description: string;
  /**
   * What an empty cell in this column may mean. Absent: the column is never empty, and a null is a
   * shape error. With one reason, an empty cell means exactly that. With several, every empty cell
   * must carry its reason in the answer's `unknowns`, and the description says how to tell them
   * apart from the row (the Veil and an outage of ours must never share a silent empty cell).
   */
  absent?: readonly Absence[];
  /**
   * The empty cell is itself the answer, as the API's own null is there (a transaction's
   * `direction` when it did not cross the shielded boundary one way): documented in the
   * description, and carrying no reason because nothing is missing.
   */
  emptyIsAnswer?: true;
}

/** One row: the object its values are read from, and its `unknowns`, keyed by row-relative path. */
export interface SourceRow {
  value: unknown;
  unknowns: Readonly<Record<string, string>>;
}

export type Cell = string | number | boolean | null;

export interface Table {
  columns: readonly ExportColumn[];
  rows: Cell[][];
  /** `rows.<i>.<column>` → reason, for every empty cell. */
  unknowns: Record<string, Absence>;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** The value at a dotted path, `undefined` when a step is missing and `null` when one is null. */
export function at(o: unknown, path: string): unknown {
  let cur: unknown = o;
  for (const part of path.split(".")) {
    if (cur === null) return null;
    if (Array.isArray(cur) && /^\d+$/.test(part)) cur = cur[Number(part)];
    else if (isObj(cur)) cur = cur[part];
    else return undefined;
  }
  return cur;
}

const ABSENCES: readonly string[] = [
  "shielded",
  "unmeasured",
  "omitted",
  "nonexistent",
  "indeterminate",
];

/** The reason recorded for a column's path in a row: on the path itself, or on a null parent. */
function reasonFor(row: SourceRow, path: string): string | undefined {
  const parts = path.split(".");
  for (let i = parts.length; i > 0; i -= 1) {
    const reason = row.unknowns[parts.slice(0, i).join(".")];
    if (reason !== undefined) return reason;
  }
  return undefined;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const INTEGER = /^-?\d+$/;
const DECIMAL = /^-?\d+(\.\d+)?$/;

/** A value, checked against its column's type: a mismatch is a shape error, loud by design. */
function typed(col: ExportColumn, v: unknown): Cell {
  const bad = () => new Error(`export column ${col.name}: unexpected ${JSON.stringify(v)}`);
  switch (col.type) {
    case "int":
    case "zat": {
      const n = typeof v === "string" && INTEGER.test(v) ? Number(v) : v;
      if (typeof n !== "number" || !Number.isSafeInteger(n)) throw bad();
      return n;
    }
    case "decimal":
      if (typeof v === "number" && Number.isFinite(v)) return v;
      if (typeof v === "string" && DECIMAL.test(v)) return v;
      throw bad();
    case "day":
      if (typeof v === "string" && DAY.test(v)) return v;
      if (typeof v === "number" && Number.isSafeInteger(v) && v % 86_400 === 0) {
        return utcDayFromSeconds(v);
      }
      throw bad();
    case "utc":
      if (typeof v !== "number" || !Number.isSafeInteger(v)) throw bad();
      return new Date(v * 1000).toISOString().replace(".000Z", "Z");
    case "text":
      if (typeof v !== "string") throw bad();
      return v;
    case "bool":
      if (typeof v !== "boolean") throw bad();
      return v;
  }
}

/**
 * Rows read through columns. A null in a column that may not be empty, a reason outside the
 * column's declared ones, or an ambiguous empty cell with no reason throws: a file that cannot say
 * what its empty cells mean is not published.
 */
export function tabulate(columns: readonly ExportColumn[], source: readonly SourceRow[]): Table {
  const unknowns: Record<string, Absence> = {};
  const rows = source.map((row, i) =>
    columns.map((col) => {
      const v = at(row.value, col.path);
      if (v !== null && v !== undefined) return typed(col, v);
      if (col.emptyIsAnswer) return null;
      const allowed = col.absent ?? [];
      const recorded = reasonFor(row, col.path);
      const reason = recorded ?? (allowed.length === 1 ? allowed[0] : undefined);
      if (reason === undefined || !ABSENCES.includes(reason)) {
        throw new Error(`export column ${col.name}: row ${i} is empty with no stated reason`);
      }
      if (!allowed.includes(reason as Absence)) {
        throw new Error(`export column ${col.name}: row ${i} is empty for "${reason}"`);
      }
      unknowns[`rows.${i}.${col.name}`] = reason as Absence;
      return null;
    }),
  );
  return { columns, rows, unknowns };
}

/** A cell as CSV text: numbers in plain decimal, booleans as `true`/`false`, null as empty. */
export function cellText(cell: Cell): string | null {
  if (cell === null) return null;
  if (typeof cell === "number") return plainNumber(cell);
  return String(cell);
}

/**
 * Rows from an answer's list at `listPath` (`data.points`), each with the `unknowns` that answer
 * filed under it (`data.points.3.avgDifficulty` → `avgDifficulty` on row 3), plus any the row
 * carries itself (list items carry their own `unknowns`).
 */
export function listRows(body: unknown, listPath: string): SourceRow[] {
  const list = at(body, listPath);
  if (!Array.isArray(list)) throw new Error(`export: no list at ${listPath}`);
  const bodyUnknowns = at(body, "unknowns");
  const filed = isObj(bodyUnknowns) ? bodyUnknowns : {};
  return list.map((value: unknown, i) => {
    const prefix = `${listPath}.${i}.`;
    const own = isObj(value) && isObj(value.unknowns) ? value.unknowns : {};
    const unknowns: Record<string, string> = {};
    for (const [k, reason] of Object.entries(own)) unknowns[k] = String(reason);
    for (const [k, reason] of Object.entries(filed)) {
      if (k.startsWith(prefix)) unknowns[k.slice(prefix.length)] = String(reason);
    }
    return { value, unknowns };
  });
}

/** One row from an object inside the answer, its `unknowns` taken from under `path`. */
export function objectRow(body: unknown, path: string): SourceRow {
  const bodyUnknowns = at(body, "unknowns");
  const filed = isObj(bodyUnknowns) ? bodyUnknowns : {};
  const prefix = path === "" ? "" : `${path}.`;
  const unknowns: Record<string, string> = {};
  for (const [k, reason] of Object.entries(filed)) {
    if (k.startsWith(prefix)) unknowns[k.slice(prefix.length)] = String(reason);
  }
  return { value: path === "" ? body : at(body, path), unknowns };
}

/**
 * A long table from a wide one: each row split into one row per key of the object at `keyPath`
 * (`pools.sapling`, `pools.orchard`, …), the key written into `keyName` and the object's fields
 * lifted beside it. Unknowns under that key follow it.
 */
export function explode(rows: readonly SourceRow[], keyPath: string, keyName: string): SourceRow[] {
  return rows.flatMap((row) => {
    const keyed = at(row.value, keyPath);
    if (!isObj(keyed)) return [];
    return Object.entries(keyed).map(([key, inner]) => {
      const unknowns: Record<string, string> = {};
      for (const [k, reason] of Object.entries(row.unknowns)) {
        if (!k.startsWith(`${keyPath}.`)) {
          unknowns[k] = reason;
        } else if (k === `${keyPath}.${key}`) {
          unknowns["value"] = reason;
        } else if (k.startsWith(`${keyPath}.${key}.`)) {
          unknowns[`value.${k.slice(keyPath.length + key.length + 2)}`] = reason;
        }
      }
      return {
        value: { ...(isObj(row.value) ? row.value : {}), [keyName]: key, value: inner },
        unknowns,
      };
    });
  });
}
