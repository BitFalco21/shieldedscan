import { createHash } from "node:crypto";
import { tableFromIPC } from "apache-arrow";
import { readMetadata, readParquet } from "parquet-wasm";
import { describe, expect, it } from "vitest";
import { arrowTable, epochDay, ROWS_PER_GROUP, toParquet, type ColumnSpec } from "../parquet";

const COLUMNS: ColumnSpec[] = [
  { name: "height", type: "int32", nullable: false },
  { name: "pool_zat", type: "int64", nullable: true },
  { name: "difficulty", type: "float64", nullable: true },
  { name: "hash", type: "utf8", nullable: false },
  { name: "complete", type: "bool", nullable: false },
  { name: "day", type: "date", nullable: false },
];

// 2^53 + 1 is the first integer a double cannot hold: it must arrive exactly.
const BIG = 9_007_199_254_740_993n;

const sample = () => [
  [0, 1, 2],
  [BIG, null, -5n],
  [1.5, null, 0],
  ["00ab", "é✓", ""],
  [true, false, true],
  ["2016-10-28", "2024-02-29", "1970-01-01"],
];

const read = (bytes: Uint8Array) => tableFromIPC(readParquet(bytes).intoIPCStream());
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

describe("Parquet writer", () => {
  it("round-trips every type exactly, NULLs included", () => {
    const t = read(toParquet(arrowTable(COLUMNS, sample())));
    expect(t.numRows).toBe(3);
    expect(t.getChild("pool_zat")!.toArray()[0]).toBe(BIG);
    expect(t.getChild("pool_zat")!.get(1)).toBeNull();
    expect(t.getChild("pool_zat")!.get(2)).toBe(-5n);
    expect(t.getChild("pool_zat")!.nullCount).toBe(1);
    expect(t.getChild("difficulty")!.get(1)).toBeNull();
    expect([...t.getChild("hash")!]).toEqual(["00ab", "é✓", ""]);
    expect([...t.getChild("complete")!]).toEqual([true, false, true]);
    // Dates come back as days since 1970 (as milliseconds in Arrow JS), never shifted.
    const days = [...t.getChild("day")!].map((d) => Number(d) / 86_400_000);
    expect(days).toEqual([epochDay("2016-10-28"), epochDay("2024-02-29"), 0]);
    expect(t.schema.fields.map((f) => [f.name, f.nullable])).toEqual(
      COLUMNS.map((c) => [c.name, c.nullable]),
    );
  });

  it("writes the same bytes for the same rows", () => {
    expect(sha(toParquet(arrowTable(COLUMNS, sample())))).toBe(
      sha(toParquet(arrowTable(COLUMNS, sample()))),
    );
  });

  it("starts a row group every ROWS_PER_GROUP rows, however the rows were gathered", () => {
    const n = ROWS_PER_GROUP * 2 + 7;
    const cols: ColumnSpec[] = [{ name: "height", type: "int32", nullable: false }];
    const bytes = toParquet(arrowTable(cols, [Array.from({ length: n }, (_, i) => i)]));
    const meta = readMetadata(bytes);
    expect(meta.rowGroups().map((g) => g.numRows())).toEqual([ROWS_PER_GROUP, ROWS_PER_GROUP, 7]);
    expect(meta.fileMetadata().createdBy()).toBe("shieldedscan open data");
  });

  it("keeps an empty table's schema", () => {
    const t = read(
      toParquet(
        arrowTable(
          COLUMNS,
          COLUMNS.map(() => []),
        ),
      ),
    );
    expect(t.numRows).toBe(0);
    expect(t.schema.fields.map((f) => f.name)).toEqual(COLUMNS.map((c) => c.name));
  });

  it("refuses a value of the wrong type rather than converting it", () => {
    const bad = sample();
    bad[1] = [1, null, 2]; // a Number where an int64 BigInt belongs: it may already have lost precision
    expect(() => arrowTable(COLUMNS, bad)).toThrow(/pool_zat: expected a BigInt/);
    const nullInRequired = sample();
    nullInRequired[0] = [0, null, 2];
    expect(() => arrowTable(COLUMNS, nullInRequired)).toThrow(/height: NULL in a non-null column/);
    const overflow = sample();
    overflow[0] = [0, 2 ** 31, 2];
    expect(() => arrowTable(COLUMNS, overflow)).toThrow(/overflows int32/);
  });

  it("refuses a date that is not a real calendar day", () => {
    expect(() => epochDay("2023-02-29")).toThrow(/not a calendar date/);
    expect(() => epochDay("2023-2-1")).toThrow(/not a date/);
  });

  it("writes exactly the bytes it wrote when the libraries were pinned", () => {
    // A bump of apache-arrow or parquet-wasm that changes a single byte changes every file's
    // checksum, and so every release's history. If this fails after an upgrade, decide on
    // purpose: keep the old version, or accept the new bytes and say so in the next release.
    const golden = toParquet(
      arrowTable(COLUMNS, [
        [0, 1],
        [BIG, null],
        [1.5, null],
        ["00ab", "é"],
        [true, false],
        ["2016-10-28", "2026-10-31"],
      ]),
    );
    expect(sha(golden)).toBe("4105dac4e4b7a1a49ae07a3ad44e522b3bb750ac99e01a475dc4fb4bef449062");
  });
});
