import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { compareHistory, REPLACED, rowKey, type PublishedFile } from "../history";
import { arrowTable, toParquet, type ColumnSpec } from "../parquet";

const COLUMNS: ColumnSpec[] = [
  { name: "day", type: "date", nullable: false },
  { name: "shielding_txs", type: "int64", nullable: true },
];

const file = (rows: [string, bigint | null][], path = "shielding_daily.parquet"): PublishedFile => {
  const bytes = toParquet(arrowTable(COLUMNS, [rows.map((r) => r[0]), rows.map((r) => r[1])]));
  return { path, sha256: createHash("sha256").update(bytes).digest("hex"), read: () => bytes };
};
const BASE: [string, bigint | null][] = [
  ["2026-10-01", 5n],
  ["2026-10-02", null],
  ["2026-10-03", 7n],
];

describe("what a release may change in published data", () => {
  it("accepts unchanged files and new rows appended", () => {
    const r = compareHistory([file(BASE)], [file([...BASE, ["2026-10-04", 9n]])]);
    expect(r).toEqual({ failures: [], fills: [] });
  });

  it("accepts a NULL becoming known, and counts it", () => {
    const filled = BASE.map((r) => (r[1] === null ? ([r[0], 3n] as [string, bigint]) : r));
    const r = compareHistory([file(BASE)], [file(filled)]);
    expect(r.failures).toEqual([]);
    expect(r.fills).toEqual([
      { path: "shielding_daily.parquet", column: "shielding_txs", cells: 1 },
    ]);
  });

  it("stops on a published value changing", () => {
    const changed = BASE.map((r) => (r[0] === "2026-10-01" ? ([r[0], 6n] as [string, bigint]) : r));
    expect(compareHistory([file(BASE)], [file(changed)]).failures).toEqual([
      "shielding_daily.parquet: 1 published values changed",
    ]);
  });

  it("stops on a published value becoming NULL", () => {
    const erased = BASE.map((r) => (r[0] === "2026-10-03" ? ([r[0], null] as [string, null]) : r));
    expect(compareHistory([file(BASE)], [file(erased)]).failures).toEqual([
      "shielding_daily.parquet: 1 published values became NULL",
    ]);
  });

  it("stops on a published row or file disappearing", () => {
    expect(compareHistory([file(BASE)], [file(BASE.slice(1))]).failures).toEqual([
      "shielding_daily.parquet: 1 published rows are gone",
    ]);
    expect(compareHistory([file(BASE)], []).failures).toEqual([
      "shielding_daily.parquet: published before, missing now",
    ]);
  });

  it("accepts a file that is new in this release", () => {
    expect(compareHistory([], [file(BASE, "transparent_daily.parquet")]).failures).toEqual([]);
  });
});

describe("the ledger's history", () => {
  const IO: ColumnSpec[] = [
    { name: "txid", type: "utf8", nullable: false },
    { name: "io", type: "utf8", nullable: false },
    { name: "ordinal", type: "int32", nullable: false },
    { name: "value_zat", type: "int64", nullable: false },
  ];
  const PATH = "transparent_io/0000000-0009999-000.parquet";
  type Row = [string, string, number, bigint];
  const ledger = (rows: Row[]): PublishedFile => {
    const values = IO.map((_, i) => rows.map((r) => r[i]!));
    const bytes = toParquet(arrowTable(IO, values));
    return {
      path: PATH,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      read: () => bytes,
    };
  };
  const OPEN: Row[] = [
    ["a", "out", 0, 5n],
    ["b", "in", 0, 5n],
    ["b", "out", 0, 4n],
  ];

  it("keys ledger rows by txid, io and ordinal, and extra rows by txid", () => {
    expect(rowKey(PATH)).toEqual(["txid", "io", "ordinal"]);
    expect(rowKey("transactions_extra/0000000-0009999.parquet")).toEqual(["txid"]);
  });

  it("lets the open range grow, and nothing else", () => {
    const grown = ledger([...OPEN, ["c", "out", 0, 9n]]);
    expect(compareHistory([ledger(OPEN)], [grown])).toEqual({ failures: [], fills: [] });
    // An input and an output share a txid and an ordinal: only `io` tells them apart.
    const swapped = ledger([OPEN[0]!, ["b", "in", 0, 4n], ["b", "out", 0, 5n]]);
    expect(compareHistory([ledger(OPEN)], [swapped]).failures).toEqual([
      `${PATH}: 2 published values changed`,
    ]);
  });

  it("never reads a carried file whose hash the manifest already has", () => {
    const published = ledger(OPEN);
    const carried = {
      ...published,
      read: () => {
        throw new Error("read");
      },
    };
    expect(compareHistory([carried], [carried]).failures).toEqual([]);
  });
});

describe("a snapshot's history", () => {
  const COLS: ColumnSpec[] = [
    { name: "address", type: "utf8", nullable: false },
    { name: "balance_zat", type: "int64", nullable: false },
  ];
  const snapshot = (rows: [string, bigint][], path = "addresses.parquet"): PublishedFile => {
    const bytes = toParquet(arrowTable(COLS, [rows.map((r) => r[0]), rows.map((r) => r[1])]));
    return { path, sha256: createHash("sha256").update(bytes).digest("hex"), read: () => bytes };
  };
  const BEFORE: [string, bigint][] = [
    ["t1a", 5n],
    ["t1b", 7n],
  ];
  const AFTER: [string, bigint][] = [
    ["t1a", 6n],
    ["t1c", 1n],
  ];

  it("lets each release replace the addresses file, rows changed and gone", () => {
    expect(REPLACED.has("addresses.parquet")).toBe(true);
    expect(compareHistory([snapshot(BEFORE)], [snapshot(AFTER)])).toEqual({
      failures: [],
      fills: [],
    });
  });

  it("still stops when the snapshot is dropped, or its columns change", () => {
    expect(compareHistory([snapshot(BEFORE)], []).failures).toEqual([
      "addresses.parquet: published before, missing now",
    ]);
    const renamed = toParquet(
      arrowTable(
        [COLS[0]!, { name: "balance", type: "int64", nullable: false }],
        [AFTER.map((r) => r[0]), AFTER.map((r) => r[1])],
      ),
    );
    const next = {
      path: "addresses.parquet",
      sha256: createHash("sha256").update(renamed).digest("hex"),
      read: () => renamed,
    };
    expect(compareHistory([snapshot(BEFORE)], [next]).failures).toEqual([
      "addresses.parquet: columns changed",
    ]);
  });

  it("holds every other file to its rows", () => {
    const day = (v: bigint) =>
      file([
        ["2026-10-01", v],
        ["2026-10-02", 1n],
      ]);
    expect(compareHistory([day(5n)], [day(6n)]).failures).toEqual([
      "shielding_daily.parquet: 1 published values changed",
    ]);
  });
});
