import type { Manifest, ManifestFile } from "../opendata/manifest";

/**
 * What one release imports, as units: each is a primary file with the companion files whose rows
 * align with it, loaded into one table in one transaction, and recorded by a marker in the same
 * transaction. A unit is therefore imported whole or not at all, which is what makes the import
 * resumable per file.
 */

export type UnitKind =
  | "blocks"
  | "transactions"
  | "transparent_io"
  | "pool_usage_daily"
  | "boundary_daily"
  | "transparent_daily"
  | "transparent_monthly"
  | "addresses";

export interface ImportUnit {
  kind: UnitKind;
  /** The primary file's path: the marker's key. */
  key: string;
  /** The primary file first, then its companions in row order. */
  files: ManifestFile[];
}

export interface ImportPlan {
  units: ImportUnit[];
  /**
   * Whether the release carries `blocks_coinbase/` (miner address and coinbase tag). An older
   * release does not, and then those two block columns stay NULL.
   */
  coinbase: boolean;
  problems: string[];
}

const RANGE = /(\d{7})-(\d{7})(?:-\d{3})?\.parquet$/;

export function fileRange(path: string): [number, number] {
  const m = RANGE.exec(path);
  if (!m) throw new Error(`no height range in ${path}`);
  return [Number(m[1]), Number(m[2])];
}

const under = (files: readonly ManifestFile[], dir: string) =>
  files
    .filter((f) => f.path.startsWith(dir))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

export function planImport(manifest: Manifest): ImportPlan {
  const problems: string[] = [];
  const byPath = new Map(manifest.files.map((f) => [f.path, f]));
  const units: ImportUnit[] = [];

  if (manifest.ledger.status !== "published") {
    problems.push(
      "this release does not carry the transparent ledger (transparent_io/); pick an earlier or later one",
    );
  }

  const coinbaseFiles = under(manifest.files, "blocks_coinbase/");
  const coinbase = coinbaseFiles.length > 0;
  for (const f of under(manifest.files, "blocks/")) {
    const companion = byPath.get(f.path.replace(/^blocks\//, "blocks_coinbase/"));
    if (coinbase && !companion) problems.push(`${f.path} has no blocks_coinbase file`);
    units.push({ kind: "blocks", key: f.path, files: companion ? [f, companion] : [f] });
  }
  if (coinbase && coinbaseFiles.length !== units.length) {
    problems.push("blocks_coinbase/ does not span the same heights as blocks/");
  }
  if (units.length === 0) problems.push("the release has no blocks");

  // Both files are ordered by (height, txid), one row per transaction, so a transactions file's
  // rows are exactly the concatenation of the extra files covering its heights.
  const extras = under(manifest.files, "transactions_extra/");
  for (const f of under(manifest.files, "transactions/")) {
    const [lo, hi] = fileRange(f.path);
    const mine = extras.filter((e) => {
      const [a, b] = fileRange(e.path);
      return a >= lo && b <= hi;
    });
    const contiguous = mine.every(
      (e, i) => i === 0 || fileRange(e.path)[0] === fileRange(mine[i - 1]!.path)[1] + 1,
    );
    if (mine.length === 0 || fileRange(mine[0]!.path)[0] !== lo || !contiguous) {
      problems.push(`${f.path}: transactions_extra/ does not cover its heights`);
    }
    units.push({ kind: "transactions", key: f.path, files: [f, ...mine] });
  }

  for (const f of under(manifest.files, "transparent_io/")) {
    units.push({ kind: "transparent_io", key: f.path, files: [f] });
  }

  const single: [UnitKind, string[]][] = [
    ["pool_usage_daily", ["pool_usage_daily.parquet"]],
    ["boundary_daily", ["shielding_daily.parquet", "shielding_records_daily.parquet"]],
    ["transparent_daily", ["transparent_daily.parquet"]],
    ["transparent_monthly", ["transparent_monthly.parquet"]],
    ["addresses", ["addresses.parquet"]],
  ];
  for (const [kind, paths] of single) {
    const files = paths.map((p) => byPath.get(p));
    if (files.some((f) => f === undefined)) {
      problems.push(`the release has no ${paths.join(" / ")}`);
      continue;
    }
    units.push({ kind, key: paths[0]!, files: files as ManifestFile[] });
  }
  return { units, coinbase, problems };
}

/** The rows a table must hold after the import: the sum of its primary files' rows. */
export function expectedRows(plan: ImportPlan, kind: UnitKind): number {
  return plan.units.filter((u) => u.kind === kind).reduce((sum, u) => sum + u.files[0]!.rows, 0);
}
