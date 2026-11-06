import { DataType, tableFromIPC, type Table } from "apache-arrow";
import { readParquet } from "parquet-wasm";

/**
 * What a new release may change in data already published. Published rows are permanent: a
 * value may go from NULL to known (a repair filled it), and that is counted in the manifest's
 * changelog. Anything else (a value changed or erased, a row gone, a file gone) stops the run
 * unless a human reruns it with `--accept-history-change`. New rows, and new files, are normal.
 */

/** A file on either side of the comparison, read only when its bytes differ. */
export interface PublishedFile {
  path: string;
  sha256: string;
  read: () => Uint8Array;
}

export interface Fill {
  path: string;
  column: string;
  cells: number;
}

export interface HistoryResult {
  failures: string[];
  fills: Fill[];
  /** Changes a committed declaration covered, one line per file, for the manifest. */
  accepted: string[];
}

/** One file's share of a declared change: which rows, by one key column, and which columns. */
export interface DeclaredScope {
  /** An exact published path. */
  path: string;
  /** The rows covered: a key column in an inclusive range. Days are `YYYY-MM-DD`. */
  rows: { column: string; from: number | string; to: number | string };
  /** Columns whose published value may change in those rows. */
  columns: readonly string[];
  /** Whether a covered row may disappear. */
  rowsMayGo?: boolean;
}

/**
 * A correction to published rows, declared in code so a release accepts exactly it and nothing
 * else, instead of a human rerunning with `--accept-history-change`, which accepts everything.
 * Reviewed like any change; written into the manifest with what it accepted. A value becoming
 * NULL is never covered. After `until` (a UTC day) it covers nothing, so a forgotten declaration
 * cannot hide a later regression in the same rows.
 */
export interface DeclaredHistoryChange {
  id: string;
  reason: string;
  until: string;
  scopes: readonly DeclaredScope[];
}

/**
 * Block 3,146,400 (NU6.1) was recorded with the ZIP-271 disbursement multisig as its miner and
 * 78,750 ZEC as the miner's reward; the miner was paid 1.25 ZEC. The repair rewrites that row
 * and recomputes 2025-11-24's payouts. The concentration figures are 30-day windows, so every
 * window holding that day moves (to 2025-12-23). Published in part 1 of the dataset.
 */
export const DECLARED_HISTORY_CHANGES: readonly DeclaredHistoryChange[] = [
  {
    id: "nu61-miner",
    reason: "block 3,146,400's miner was recorded as the ZIP-271 disbursement multisig",
    until: "2026-12-31",
    scopes: [
      {
        path: "blocks/3000000-3499999.parquet",
        rows: { column: "height", from: 3_146_400, to: 3_146_400 },
        columns: ["miner_reward_zat"],
      },
      {
        path: "blocks_coinbase/3000000-3499999.parquet",
        rows: { column: "height", from: 3_146_400, to: 3_146_400 },
        columns: ["miner_address"],
      },
      {
        path: "mining_payouts_daily.parquet",
        rows: { column: "day", from: "2025-11-24", to: "2025-11-24" },
        columns: ["blocks", "reward_zat", "fee_zat", "fee_blocks"],
        rowsMayGo: true,
      },
      {
        path: "mining_concentration_daily.parquet",
        rows: { column: "day", from: "2025-11-24", to: "2025-12-23" },
        columns: ["distinct_addresses", "top1_share", "top3_share", "top5_share"],
      },
    ],
  },
];

/**
 * Snapshots: files replaced whole by each release, so the rule above cannot apply to their rows.
 * They are still never dropped, and the manifest records the height each one stands at.
 */
export const REPLACED: ReadonlySet<string> = new Set(["addresses.parquet"]);

/** The columns that identify a row in each file; a `blocks/` file is in height order. */
export function rowKey(path: string): readonly string[] {
  if (path.startsWith("blocks/")) return ["height"];
  if (path.startsWith("blocks_coinbase/")) return ["height"];
  if (path.startsWith("transactions/")) return ["txid"];
  if (path.startsWith("transparent_io/")) return ["txid", "io", "ordinal"];
  if (path.startsWith("transactions_extra/")) return ["txid"];
  const keys: Record<string, readonly string[]> = {
    "pool_usage_daily.parquet": ["day", "pool"],
    "shielding_daily.parquet": ["day"],
    "transparent_daily.parquet": ["day"],
    "transparent_monthly.parquet": ["month"],
    "node_releases_daily.parquet": ["day", "client", "version", "protocol_version"],
    "nu7_capable_releases.parquet": ["client"],
    "reorgs.parquet": ["height", "orphaned_hash"],
    "blocks_daily.parquet": ["day"],
    "fees_daily.parquet": ["day", "kind"],
    "mining_daily.parquet": ["day", "miner"],
    "mining_concentration_daily.parquet": ["day"],
    "hashrate_daily.parquet": ["day"],
    "supply_daily.parquet": ["day"],
    "nsm_daily.parquet": ["day"],
    "tx_versions_daily.parquet": ["day", "version"],
    "pool_flows_daily.parquet": ["day", "pool"],
    "coinbase_shielded_daily.parquet": ["day"],
    "tx_kinds_daily.parquet": ["day"],
    "pools_daily.parquet": ["day"],
    "pool_boundary_daily.parquet": ["day", "pool"],
    "shielding_flow_daily.parquet": ["day"],
    "pool_migration_daily.parquet": ["day", "destination", "source"],
    "fees_monthly.parquet": ["month", "kind"],
    "shielding_records_daily.parquet": ["day"],
    "mining_payouts_daily.parquet": ["day", "kind", "address"],
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

/** A row-key cell as a comparable value: a date as `YYYY-MM-DD`, an integer as a number. */
function keyValue(t: Table, column: string, row: number): number | string | null {
  const v: unknown = t.getChild(column)?.get(row);
  if (v === null || v === undefined) return null;
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  if (v instanceof Date) return day(v.getTime());
  if (typeof v === "bigint") return Number(v);
  const type = t.schema.fields.find((f) => f.name === column)?.type;
  if (typeof v === "number" && type !== undefined && DataType.isDate(type)) return day(v);
  return typeof v === "number" || typeof v === "string" ? v : null;
}

const within = (v: number | string | null, from: number | string, to: number | string) =>
  v !== null && typeof v === typeof from && v >= from && v <= to;

/** UTC today, as the declarations' `until` is written. */
const utcToday = () => new Date().toISOString().slice(0, 10);

export function compareHistory(
  previous: readonly PublishedFile[],
  next: readonly PublishedFile[],
  declared: readonly DeclaredHistoryChange[] = DECLARED_HISTORY_CHANGES,
  today: string = utcToday(),
): HistoryResult {
  const failures: string[] = [];
  const accepted: string[] = [];
  const fills = new Map<string, Fill>();
  const nextByPath = new Map(next.map((f) => [f.path, f]));
  const live = declared.filter((d) => today <= d.until);

  for (const prev of previous) {
    const now = nextByPath.get(prev.path);
    if (!now) {
      failures.push(`${prev.path}: published before, missing now`);
      continue;
    }
    if (prev.sha256 === now.sha256) continue;

    const a = read(prev.read());
    const b = read(now.read());
    const columns = a.schema.fields.map((f) => f.name);
    const bColumns = b.schema.fields.map((f) => f.name);
    if (JSON.stringify(columns) !== JSON.stringify(bColumns)) {
      failures.push(`${prev.path}: columns changed`);
      continue;
    }
    if (REPLACED.has(prev.path)) continue;
    const key = rowKey(prev.path);
    const keyOf = (t: Table, i: number) => JSON.stringify(key.map((k) => cell(t, k, i)));
    const index = new Map<string, number>();
    for (let i = 0; i < b.numRows; i++) index.set(keyOf(b, i), i);

    const scopes = live.flatMap((d) =>
      d.scopes.filter((s) => s.path === prev.path).map((scope) => ({ id: d.id, scope })),
    );
    /** The declared scope covering published row `i`, if any. */
    const coverOf = (i: number) =>
      scopes.find(({ scope: { rows } }) => within(keyValue(a, rows.column, i), rows.from, rows.to));
    const tally = new Map<string, { values: number; rows: number }>();
    const accept = (id: string, kind: "values" | "rows") => {
      const t = tally.get(id) ?? { values: 0, rows: 0 };
      t[kind]++;
      tally.set(id, t);
    };

    let changed = 0;
    let erased = 0;
    let missing = 0;
    for (let i = 0; i < a.numRows; i++) {
      const cover = scopes.length === 0 ? undefined : coverOf(i);
      const j = index.get(keyOf(a, i));
      if (j === undefined) {
        if (cover?.scope.rowsMayGo) accept(cover.id, "rows");
        else missing++;
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
        else if (cover?.scope.columns.includes(col)) accept(cover.id, "values");
        else changed++;
      }
    }
    if (missing) failures.push(`${prev.path}: ${missing} published rows are gone`);
    if (erased) failures.push(`${prev.path}: ${erased} published values became NULL`);
    if (changed) failures.push(`${prev.path}: ${changed} published values changed`);
    for (const [id, t] of tally) {
      accepted.push(
        `${id}: ${prev.path}: ${t.values} published values changed, ${t.rows} rows gone`,
      );
    }
  }
  return { failures, fills: [...fills.values()], accepted };
}
