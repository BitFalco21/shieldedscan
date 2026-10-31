import { tableFromIPC, type Table } from "apache-arrow";
import { readParquet } from "parquet-wasm";

/**
 * What a new release may change in data already published. Published rows are permanent: a
 * value may go from NULL to known (a repair filled it), and that is counted in the manifest's
 * changelog. Anything else (a value changed or erased, a row gone, a file gone) stops the run
 * unless a human reruns it with `--accept-history-change`. New rows, and new files, are normal.
 */

export interface PublishedFile {
  path: string;
  bytes: Uint8Array;
}

export interface Fill {
  path: string;
  column: string;
  cells: number;
}

export interface HistoryResult {
  failures: string[];
  fills: Fill[];
}

/** The columns that identify a row in each file; a `blocks/` file is in height order. */
export function rowKey(path: string): readonly string[] {
  if (path.startsWith("blocks/")) return ["height"];
  const keys: Record<string, readonly string[]> = {
    "pool_usage_daily.parquet": ["day", "pool"],
    "shielding_daily.parquet": ["day"],
    "transparent_daily.parquet": ["day"],
    "transparent_monthly.parquet": ["month"],
    "node_releases_daily.parquet": ["day", "client", "version", "protocol_version"],
    "reorgs.parquet": ["height", "orphaned_hash"],
  };
  const k = keys[path];
  if (!k) throw new Error(`no row key for ${path}`);
  return k;
}

const read = (bytes: Uint8Array): Table => tableFromIPC(readParquet(bytes).intoIPCStream());

/** A cell as a comparable primitive: BigInts and dates as strings, so `===` is exact. */
function cell(t: Table, column: string, row: number): string | number | boolean | null {
  const v: unknown = t.getChild(column)?.get(row);
  if (v === null || v === undefined) return null;
  if (typeof v === "bigint") return `${v}n`;
  if (v instanceof Date) return `date:${v.getTime()}`;
  if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") return v;
  return JSON.stringify(v);
}

export function compareHistory(
  previous: readonly PublishedFile[],
  next: readonly PublishedFile[],
  sameBytes: (a: Uint8Array, b: Uint8Array) => boolean,
): HistoryResult {
  const failures: string[] = [];
  const fills = new Map<string, Fill>();
  const nextByPath = new Map(next.map((f) => [f.path, f]));

  for (const prev of previous) {
    const now = nextByPath.get(prev.path);
    if (!now) {
      failures.push(`${prev.path}: published before, missing now`);
      continue;
    }
    if (sameBytes(prev.bytes, now.bytes)) continue;

    const a = read(prev.bytes);
    const b = read(now.bytes);
    const columns = a.schema.fields.map((f) => f.name);
    const bColumns = b.schema.fields.map((f) => f.name);
    if (JSON.stringify(columns) !== JSON.stringify(bColumns)) {
      failures.push(`${prev.path}: columns changed`);
      continue;
    }
    const key = rowKey(prev.path);
    const keyOf = (t: Table, i: number) => JSON.stringify(key.map((k) => cell(t, k, i)));
    const index = new Map<string, number>();
    for (let i = 0; i < b.numRows; i++) index.set(keyOf(b, i), i);

    let changed = 0;
    let erased = 0;
    let missing = 0;
    for (let i = 0; i < a.numRows; i++) {
      const j = index.get(keyOf(a, i));
      if (j === undefined) {
        missing++;
        continue;
      }
      for (const col of columns) {
        const before = cell(a, col, i);
        const after = cell(b, col, j);
        if (before === after) continue;
        if (before === null) {
          const k = `${prev.path}\u0000${col}`;
          const f = fills.get(k) ?? { path: prev.path, column: col, cells: 0 };
          f.cells++;
          fills.set(k, f);
        } else if (after === null) erased++;
        else changed++;
      }
    }
    if (missing) failures.push(`${prev.path}: ${missing} published rows are gone`);
    if (erased) failures.push(`${prev.path}: ${erased} published values became NULL`);
    if (changed) failures.push(`${prev.path}: ${changed} published values changed`);
  }
  return { failures, fills: [...fills.values()] };
}
