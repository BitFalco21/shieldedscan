import { describe, expect, it } from "vitest";
import {
  exportKey,
  exportQueryString,
  isExportPath,
  MAX_PREVIEW_ROWS,
  parseDataExportCard,
  type DataExportCard,
} from "../data-export";

/**
 * The export card's wire: the console accepts exactly what the tool builds and drops everything
 * else whole, so a forged, truncated or hostile event can never draw a link, a figure or a host.
 */

const ADDRESS = "t1Mv595nLBUxJxKAfAZAG9RjhibExEErmMf";

const CARD: DataExportCard = {
  v: 1,
  dataset: "pool-balances",
  path: "/v1/analytics/pools",
  query: [
    ["from", "2026-01-01"],
    ["to", "2026-11-05"],
    ["interval", "day"],
  ],
  fileName: "shieldedscan_pool-balances_from-2026-01-01_interval-day_to-2026-11-05.csv",
  rows: 308,
  paged: false,
  truncated: false,
  readOnDownload: false,
  columns: [
    { name: "period_start", type: "day" },
    { name: "orchard_zat", type: "zat" },
  ],
  through: "2026-11-03",
  height: 3_500_000,
  coverage: "partial",
  preview: [
    ["2026-01-01", "439800342005093"],
    ["2026-01-02", { absent: "unmeasured" }],
    ["2026-01-03", { empty: true }],
  ],
};

const withField = (patch: Record<string, unknown>) => ({ ...CARD, ...patch });

describe("parseDataExportCard", () => {
  it("accepts a card exactly as the tool builds it", () => {
    expect(parseDataExportCard(JSON.parse(JSON.stringify(CARD)))).toEqual(CARD);
  });

  it("accepts an address history read on download, with no preview", () => {
    const card = withField({
      dataset: "address-transactions-history",
      path: `/v1/addresses/${ADDRESS}/export`,
      query: [],
      fileName: `shieldedscan_address_${ADDRESS}.csv`,
      readOnDownload: true,
      preview: [],
      through: null,
      height: null,
      coverage: null,
    });
    expect(parseDataExportCard(card)).not.toBeNull();
    // A preview on a file not read yet is not something the tool sends.
    expect(parseDataExportCard({ ...card, preview: [["1", "2"]] })).toBeNull();
  });

  it.each([
    ["a path off /v1", { path: "/chain/analytics/supply" }],
    ["a path with a host", { path: "https://evil.example/v1/blocks" }],
    ["a protocol-relative path", { path: "//evil.example/v1/blocks" }],
    ["a path outside the export list", { path: "/v1/addresses/t1abc/activity" }],
    ["a cross-chain path", { path: "/v1/crosschain/aggregate" }],
    [
      "a shielded address's history",
      { path: "/v1/addresses/zs1abcdefghijklmnopqrstuvwxyz0123/export" },
    ],
    ["a traversal", { path: "/v1/blocks/../agent/ask" }],
    ["a query that sets format", { query: [["format", "csv"]] }],
    ["a query value with a URL", { query: [["from", "https://evil.example"]] }],
    ["a query value with a quote", { query: [["from", '2026"><script>']] }],
    [
      "a repeated query key",
      {
        query: [
          ["from", "2026-01-01"],
          ["from", "2026-01-02"],
        ],
      },
    ],
    ["a file name with a path", { fileName: "../etc/passwd.csv" }],
    ["a file name that is not a CSV", { fileName: "shieldedscan_x.exe" }],
    ["a dataset with spaces", { dataset: "pool balances" }],
    ["a negative row count", { rows: -1 }],
    ["a fractional row count", { rows: 1.5 }],
    ["a row count as text", { rows: "308" }],
    ["an unknown column type", { columns: [{ name: "x", type: "money" }] }],
    ["a column name with markup", { columns: [{ name: "<b>x</b>", type: "int" }] }],
    ["no columns", { columns: [] }],
    ["a preview row of the wrong width", { preview: [["2026-01-01"]] }],
    ["a reason outside the vocabulary", { preview: [["2026-01-01", { absent: "zero" }]] }],
    ["a numeric cell (cells are the file's text)", { preview: [["2026-01-01", 5]] }],
    ["a cell carrying two keys", { preview: [["x", { absent: "shielded", empty: true }]] }],
    ["too many preview rows", { preview: Array.from({ length: 10 }, () => ["a", "b"]) }],
    ["more preview rows than the file has", { rows: 1 }],
    ["a through that is not a day", { through: "yesterday" }],
    ["an unknown coverage", { coverage: "exact" }],
    ["a missing version", { v: 2 }],
  ])("drops %s", (_name, patch) => {
    expect(parseDataExportCard(withField(patch))).toBeNull();
  });

  it("drops a card whose cell is longer than a card shows", () => {
    expect(parseDataExportCard(withField({ preview: [["x", "9".repeat(121)]] }))).toBeNull();
  });

  it.each([null, [], "card", 42])("drops a payload that is not an object: %j", (raw) => {
    expect(parseDataExportCard(raw)).toBeNull();
  });

  it("caps the preview at a few rows", () => {
    expect(MAX_PREVIEW_ROWS).toBeLessThanOrEqual(5);
  });
});

describe("export links", () => {
  it("puts format last and keeps the server's order", () => {
    expect(exportQueryString(CARD, "csv")).toBe(
      "from=2026-01-01&to=2026-11-05&interval=day&format=csv",
    );
    expect(exportQueryString({ query: [] }, "json")).toBe("format=json");
  });

  it("keys a card by the call it names", () => {
    expect(exportKey(CARD)).toBe("/v1/analytics/pools?from=2026-01-01&to=2026-11-05&interval=day");
    expect(exportKey({ ...CARD, query: [] })).toBe("/v1/analytics/pools?");
  });

  it("knows the paths the tool builds and nothing else", () => {
    for (const path of [
      "/v1/analytics/pools",
      "/v1/analytics/miners",
      "/v1/prices/daily",
      "/v1/blocks",
      "/v1/blocks/3428150/transactions",
      `/v1/blocks/${"ab".repeat(32)}/transactions`,
      `/v1/addresses/${ADDRESS}/export`,
    ]) {
      expect(isExportPath(path), path).toBe(true);
    }
    for (const path of [
      "/v1/analytics/records",
      "/v1/analytics/monthly",
      "/v1/blocks/1e9/transactions",
      "/v1/addresses/u1abcdefghijklmnopqrstuvwxyz/export",
      "/v1/agent",
    ]) {
      expect(isExportPath(path), path).toBe(false);
    }
  });
});
