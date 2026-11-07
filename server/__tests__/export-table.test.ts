import { describe, expect, it } from "vitest";
import { csvField, csvRecord, plainNumber } from "../v1/export/csv";
import { col } from "../v1/export/spec";
import { explode, listRows, tabulate } from "../v1/export/table";
import { tableCsv } from "../v1/export/render";

/**
 * The file format itself: RFC 4180 quoting, NULL as an empty field and never 0, integers that
 * cannot lose a digit, and the rule that every empty cell has exactly one stated meaning.
 */

describe("RFC 4180 fields", () => {
  it("quotes only what needs it, and doubles quotes inside", () => {
    expect(csvField("plain")).toBe("plain");
    expect(csvField("a,b")).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField("two\nlines")).toBe('"two\nlines"');
    expect(csvField("cr\r")).toBe('"cr\r"');
    // Spaces are data: kept as they are, and need no quotes.
    expect(csvField(" padded ")).toBe(" padded ");
  });

  it("writes NULL as an empty field, distinct from a zero and from an empty string", () => {
    expect(csvRecord([null, "0", ""])).toBe(",0,\r\n");
    // An empty string and NULL look alike in CSV, which is why no export column is ever an
    // empty string: text columns hold identifiers and closed vocabularies.
    expect(csvRecord(["a", null])).toBe("a,\r\n");
  });

  it("ends every record, the last included, with CRLF", () => {
    expect(csvRecord(["a", "b"])).toBe("a,b\r\n");
  });
});

describe("numbers", () => {
  it("writes integers exactly up to 2^53 − 1 and refuses beyond", () => {
    expect(plainNumber(Number.MAX_SAFE_INTEGER)).toBe("9007199254740991");
    expect(plainNumber(2_100_000_000_000_000)).toBe("2100000000000000"); // max supply in zat
    expect(plainNumber(-12_345)).toBe("-12345");
    expect(() => plainNumber(Number.MAX_SAFE_INTEGER + 2)).toThrow(/precision/);
  });

  it("never writes exponent notation, and refuses NaN and infinities", () => {
    expect(plainNumber(1e-7)).toBe("0.0000001");
    expect(plainNumber(0.5)).toBe("0.5");
    expect(plainNumber(12.34)).toBe("12.34");
    expect(() => plainNumber(Number.NaN)).toThrow();
    expect(() => plainNumber(Number.POSITIVE_INFINITY)).toThrow();
  });
});

describe("tabulate", () => {
  const cols = [
    col("day", "day", "day", "d"),
    col("value_zat", "zat", "v.zat", "v", ["unmeasured"]),
    col("fee_zat", "zat", "fee", "f", ["nonexistent", "indeterminate"]),
  ];
  const row = (value: unknown, unknowns: Record<string, string> = {}) => ({ value, unknowns });

  it("reads typed values through paths and states each empty cell's reason", () => {
    const t = tabulate(cols, [
      row({ day: "2026-01-01", v: { zat: 5 }, fee: 10 }),
      row({ day: "2026-01-02", v: null, fee: null }, { fee: "nonexistent" }),
    ]);
    expect(t.rows).toEqual([
      ["2026-01-01", 5, 10],
      ["2026-01-02", null, null],
    ]);
    // A null parent object empties every column beneath it, with the one declared reason.
    expect(t.unknowns).toEqual({
      "rows.1.value_zat": "unmeasured",
      "rows.1.fee_zat": "nonexistent",
    });
  });

  it("refuses a null in a column that may not be empty", () => {
    expect(() => tabulate(cols, [row({ day: null, v: { zat: 1 }, fee: 1 })])).toThrow(/day/);
  });

  it("refuses an ambiguous empty cell that carries no reason", () => {
    expect(() => tabulate(cols, [row({ day: "2026-01-01", v: { zat: 1 }, fee: null })])).toThrow(
      /no stated reason/,
    );
  });

  it("refuses a reason the column did not declare (the Veil is never an outage)", () => {
    expect(() =>
      tabulate(cols, [row({ day: "2026-01-01", v: null, fee: 1 }, { v: "shielded" })]),
    ).toThrow(/shielded/);
  });

  it("refuses a value of the wrong type rather than writing it", () => {
    expect(() => tabulate(cols, [row({ day: "2026-01-01", v: { zat: 1.5 }, fee: 1 })])).toThrow();
    expect(() => tabulate(cols, [row({ day: "Jan 1", v: { zat: 1 }, fee: 1 })])).toThrow();
  });

  it("converts unix seconds to UTC days and instants", () => {
    const t = tabulate(
      [col("d", "day", "d", ""), col("t", "utc", "t", "")],
      [row({ d: 1_785_542_400, t: 1_785_542_401 })],
    );
    expect(t.rows[0]).toEqual(["2026-08-01", "2026-08-01T00:00:01Z"]);
  });

  it("gives an empty answer its header row", () => {
    expect(tableCsv(tabulate(cols, []))).toBe("day,value_zat,fee_zat\r\n");
  });
});

describe("rows from an answer", () => {
  const body = {
    data: {
      points: [
        { periodStart: "2026-01-01", pools: { sapling: { n: 1 }, sprout: { n: null } } },
        { periodStart: "2026-02-01", pools: { sapling: { n: 2 }, sprout: { n: null } } },
      ],
    },
    unknowns: {
      "data.points.0.pools.sprout.n": "unmeasured",
      "data.points.1.pools.sprout.n": "unmeasured",
      "data.totals.x": "omitted",
    },
  };

  it("files each unknown under its row, relative to it", () => {
    const rows = listRows(body, "data.points");
    expect(rows[1]!.unknowns).toEqual({ "pools.sprout.n": "unmeasured" });
  });

  it("follows unknowns into a long table, row per key", () => {
    const long = explode(listRows(body, "data.points"), "pools", "pool");
    expect(long.map((r) => (r.value as { pool: string }).pool)).toEqual([
      "sapling",
      "sprout",
      "sapling",
      "sprout",
    ]);
    expect(long[3]!.unknowns).toEqual({ "value.n": "unmeasured" });
    const t = tabulate(
      [
        col("pool", "text", "pool", ""),
        col("n", "int", "value.n", "", ["unmeasured", "nonexistent"]),
      ],
      long,
    );
    expect(t.unknowns).toEqual({ "rows.1.n": "unmeasured", "rows.3.n": "unmeasured" });
  });
});
