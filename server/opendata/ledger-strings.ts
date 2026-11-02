import { tableFromIPC } from "apache-arrow";
import { readParquet } from "parquet-wasm";
import { scanStrings, type Findings } from "./checks";

/**
 * The ledger's text columns, held to their formats before a part is written. `script_type` is the
 * node's own free text, published as is: it is held to a format, not to a list, so a script type a
 * new node release names does not stop the dataset, and a value that is not a type name does.
 * `address` is published by design (plan [I9]); every other text column also goes through
 * `scanStrings`, the second lock.
 */

const HEX64 = /^[0-9a-f]{64}$/;
const SCRIPT_TYPE = /^[a-z0-9_]{1,32}$/;
const IO = new Set(["in", "out"]);

/**
 * The columns read, by name: a part from the builder, or one read back from the cache. Values are
 * unknown because a file read back is not trusted to hold the types it should.
 */
export type LedgerTextColumns = Record<
  "txid" | "block_height" | "io" | "script_type" | "prev_txid",
  readonly unknown[]
>;

export const LEDGER_TEXT_COLUMNS = [
  "txid",
  "block_height",
  "io",
  "script_type",
  "prev_txid",
] as const satisfies readonly (keyof LedgerTextColumns)[];

/**
 * A cached `transparent_io` part's text columns, read back from its bytes; only these columns are
 * decoded, so a part of ~500k rows costs a few hundred megabytes at most. Null if one is missing.
 */
export function readLedgerText(parquet: Uint8Array): LedgerTextColumns | null {
  const table = tableFromIPC(
    readParquet(parquet, { columns: [...LEDGER_TEXT_COLUMNS] }).intoIPCStream(),
  );
  const columns: Partial<Record<(typeof LEDGER_TEXT_COLUMNS)[number], unknown[]>> = {};
  for (const name of LEDGER_TEXT_COLUMNS) {
    const vector = table.getChild(name);
    if (vector === null) return null;
    columns[name] = Array.from(vector as Iterable<unknown>);
  }
  return columns as LedgerTextColumns;
}

const isText = (v: unknown, format: RegExp) => typeof v === "string" && format.test(v);

/** Adds a finding per malformed value, with its height, and one per column `scanStrings` flags. */
export function checkLedgerStrings(f: Findings, c: LedgerTextColumns): void {
  const rows = c.txid.length;
  if (rows === 0) return;
  const at = (i: number) => String(c.block_height[i]);
  for (let i = 0; i < rows; i++) {
    if (!isText(c.txid[i], HEX64)) f.add("malformed txid", at(i));
    const io = c.io[i];
    if (typeof io !== "string" || !IO.has(io)) f.add("io neither in nor out", at(i));
    const script = c.script_type[i] ?? null;
    if (script !== null && !isText(script, SCRIPT_TYPE)) f.add("malformed script_type", at(i));
    const prev = c.prev_txid[i] ?? null;
    if (prev !== null && !isText(prev, HEX64)) f.add("malformed prev_txid", at(i));
  }
  // A dictionary column holds a handful of values: each is scanned once.
  const text = (values: readonly unknown[]) =>
    values.filter((v): v is string | null => v === null || typeof v === "string");
  const heights = `heights ${at(0)}-${at(rows - 1)}`;
  for (const [column, values] of [
    ["txid", text(c.txid)],
    ["io", [...new Set(text(c.io))]],
    ["script_type", [...new Set(text(c.script_type))]],
    ["prev_txid", text(c.prev_txid)],
  ] as const) {
    for (const problem of scanStrings("transparent_io", column, values)) f.add(problem, heights);
  }
}
