import { describe, expect, it } from "vitest";
import { compareHistory, type PublishedFile } from "../history";
import { arrowTable, toParquet, type ColumnSpec } from "../parquet";

const COLUMNS: ColumnSpec[] = [
  { name: "day", type: "date", nullable: false },
  { name: "shielding_txs", type: "int64", nullable: true },
];

const file = (
  rows: [string, bigint | null][],
  path = "shielding_daily.parquet",
): PublishedFile => ({
  path,
  bytes: toParquet(arrowTable(COLUMNS, [rows.map((r) => r[0]), rows.map((r) => r[1])])),
});

const same = (a: Uint8Array, b: Uint8Array) => Buffer.compare(a, b) === 0;
const BASE: [string, bigint | null][] = [
  ["2026-10-01", 5n],
  ["2026-10-02", null],
  ["2026-10-03", 7n],
];

describe("what a release may change in published data", () => {
  it("accepts unchanged files and new rows appended", () => {
    const r = compareHistory([file(BASE)], [file([...BASE, ["2026-10-04", 9n]])], same);
    expect(r).toEqual({ failures: [], fills: [] });
  });

  it("accepts a NULL becoming known, and counts it", () => {
    const filled = BASE.map((r) => (r[1] === null ? ([r[0], 3n] as [string, bigint]) : r));
    const r = compareHistory([file(BASE)], [file(filled)], same);
    expect(r.failures).toEqual([]);
    expect(r.fills).toEqual([
      { path: "shielding_daily.parquet", column: "shielding_txs", cells: 1 },
    ]);
  });

  it("stops on a published value changing", () => {
    const changed = BASE.map((r) => (r[0] === "2026-10-01" ? ([r[0], 6n] as [string, bigint]) : r));
    expect(compareHistory([file(BASE)], [file(changed)], same).failures).toEqual([
      "shielding_daily.parquet: 1 published values changed",
    ]);
  });

  it("stops on a published value becoming NULL", () => {
    const erased = BASE.map((r) => (r[0] === "2026-10-03" ? ([r[0], null] as [string, null]) : r));
    expect(compareHistory([file(BASE)], [file(erased)], same).failures).toEqual([
      "shielding_daily.parquet: 1 published values became NULL",
    ]);
  });

  it("stops on a published row or file disappearing", () => {
    expect(compareHistory([file(BASE)], [file(BASE.slice(1))], same).failures).toEqual([
      "shielding_daily.parquet: 1 published rows are gone",
    ]);
    expect(compareHistory([file(BASE)], [], same).failures).toEqual([
      "shielding_daily.parquet: published before, missing now",
    ]);
  });

  it("accepts a file that is new in this release", () => {
    expect(compareHistory([], [file(BASE, "transparent_daily.parquet")], same).failures).toEqual(
      [],
    );
  });
});
