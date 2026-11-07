import { Hono } from "hono";
import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import {
  allSeriesSpecs,
  EXPORT_COLUMN_TYPES,
  isExportPath,
  parseDataExportCard,
  type DataExportCard,
} from "@/domain";
import { API_BASE_URL } from "@/api-catalogue/base-url";
import { v1SeriesRoutes } from "../../v1/analytics-series";
import { ADDRESS_EXPORT_CAP, ADDRESS_EXPORT_PATTERN } from "../../v1/export/address-route";
import { EXPORTS } from "../../v1/export/registry";
import type { ColumnType } from "../../v1/export/table";
import { v1MinersRoutes } from "../../v1/miners";
import { v1TransparentRoutes } from "../../v1/transparent-series";
import type { AnalyticsData } from "../../v1/windowed/data";
import { windowedAnalyticsRoutes } from "../../v1/windowed/routes";
import { AgentTools, type V1Requester } from "../tools";
import { EXPORT_LIST_FAMILIES, parseExportArgs, type ExportRequest } from "../tools/export-args";
import { isExportRefusal } from "../tools/export-refusal";
import {
  addressTarget,
  listTarget,
  seriesTarget,
  type ExportTarget,
} from "../tools/export-targets";
import { ADDRESS_INFO, FIXTURE_NOW_MS, makeChain, makeV1 } from "../testing/fixture-world";

/**
 * `export_data`: every family maps to a route the export registry serves, with a query that route
 * accepts; the card is the API's own answer for that exact call, its preview the file's first
 * rows; and nothing the model reads carries the link or the rows.
 */

const ADDRESS = ADDRESS_INFO.address;
const WINDOWS: Record<string, unknown>[] = [
  { range: "30d" },
  { range: "1y" },
  { range: "all" },
  { from: "2026-01-01", to: "2026-07-01" },
];

function requestFor(args: Record<string, unknown>): ExportRequest {
  const req = parseExportArgs(args, FIXTURE_NOW_MS);
  if (isExportRefusal(req)) throw new Error(`refused ${JSON.stringify(args)}: ${req.message}`);
  return req;
}

function targetOf(req: ExportRequest): ExportTarget | null {
  if (req.kind === "address") return addressTarget(req.address);
  if (req.kind === "list") return listTarget(req);
  const t = seriesTarget(req.spec, req.window, req.interval);
  return isExportRefusal(t) ? null : t;
}

/** Every argument set the families allow, over each window: what the sweep below runs. */
function everyAsk(): Record<string, unknown>[] {
  const series = allSeriesSpecs()
    .filter((s) => s.family !== "crosschain")
    .flatMap((spec) =>
      WINDOWS.map((w): Record<string, unknown> => ({ ...spec, ...w })).filter(
        // A daily price file is refused past 1,000 days; that refusal is tested on its own.
        (a) => !(spec.family === "price" && a.range === "all"),
      ),
    );
  const lists: Record<string, unknown>[] = [
    { family: "blocks" },
    { family: "transaction-list" },
    { family: "transaction-list", kind: "shielded", pool: "orchard", range: "30d" },
    { family: "transaction-list", kind: "mixed", from: "2026-07-01", to: "2026-08-01" },
    { family: "block-transactions", block: "3428150" },
    { family: "block-transactions", block: "0".repeat(64) },
    { family: "rich-list" },
    { family: "reorgs" },
    { family: "supply-by-pool" },
    { family: "miners" },
    { family: "miners", range: "30d" },
    { family: "address-history", address: ADDRESS },
  ];
  return [...series, ...lists];
}

/**
 * The real routes' parameter checks, with no data behind them: a query a route cannot read is a
 * 400 before any read, so anything else proves the URL is one the API accepts.
 */
function paramsApp(): Hono {
  const failing = { query: () => Promise.reject(new Error("no database here")) } as unknown as Pool;
  const absent = () => Promise.reject(new Error("no data here"));
  const data: AnalyticsData = {
    tip: absent,
    heights: absent,
    window: absent,
    poolTxByBucket: absent,
    flows: absent,
    migrations: absent,
    crosschain: absent,
    dailyThrough: absent,
    currencies: () => ["usd"],
  };
  const app = new Hono();
  app.route("/", v1SeriesRoutes({ pool: failing, ironwoodActivationHeight: 3_400_000 }));
  app.route("/", windowedAnalyticsRoutes({ data, now: () => FIXTURE_NOW_MS }));
  app.route("/", v1MinersRoutes({ pool: failing, now: () => FIXTURE_NOW_MS, load: absent }));
  app.route("/", v1TransparentRoutes({ pool: failing, now: () => FIXTURE_NOW_MS, load: absent }));
  app.route("/", makeV1());
  return app;
}

describe("family → route", () => {
  const app = paramsApp();

  it("names only routes the export registry serves, on paths the console accepts", () => {
    for (const ask of everyAsk()) {
      const target = targetOf(requestFor(ask));
      if (target === null) continue;
      const registered =
        target.pattern === ADDRESS_EXPORT_PATTERN || EXPORTS[target.pattern] !== undefined;
      expect(registered, `${JSON.stringify(ask)} → ${target.pattern}`).toBe(true);
      expect(isExportPath(target.path), target.path).toBe(true);
      expect(new Set(target.query.map(([k]) => k)).size).toBe(target.query.length);
    }
  });

  it("builds queries every route accepts as they are", async () => {
    for (const ask of everyAsk()) {
      const target = targetOf(requestFor(ask));
      if (target === null || target.pattern === ADDRESS_EXPORT_PATTERN) continue;
      const qs = new URLSearchParams(target.query).toString();
      const res = await app.request(`${target.path}${qs === "" ? "" : `?${qs}`}`);
      const text = await res.text();
      // A 404 naming the thing ("no such block") is the route answering; one for the path is not.
      const accepted = res.status !== 400 && (res.status !== 404 || /no such block/.test(text));
      expect(accepted, `${JSON.stringify(ask)} → ${res.status} ${text}`).toBe(true);
    }
  });

  it("refuses the series /v1 keeps no history of, naming the nearest file", () => {
    for (const spec of allSeriesSpecs().filter((s) => s.family !== "crosschain")) {
      const req = requestFor({ ...spec, range: "1y" });
      if (req.kind !== "series") continue;
      const t = seriesTarget(req.spec, req.window, req.interval);
      if (!isExportRefusal(t)) continue;
      expect(["supply", "mining"]).toContain(spec.family);
      expect(t.reason).toBe("not-exportable");
      // The nearest is itself an export the tool makes.
      for (const closest of t.closest ?? []) {
        const near = targetOf(requestFor(closest));
        expect(near, JSON.stringify(closest)).not.toBeNull();
      }
    }
  });

  it("covers every list family", () => {
    const asked = new Set(everyAsk().map((a) => a.family));
    for (const family of EXPORT_LIST_FAMILIES) expect(asked.has(family), family).toBe(true);
  });

  it("asks a daily price file with an inclusive end, the route's own convention", () => {
    const t = targetOf(requestFor({ family: "price", from: "2026-07-01", to: "2026-08-01" }))!;
    expect(t.query).toEqual([
      ["from", "2026-07-01"],
      ["to", "2026-07-31"],
    ]);
  });

  it("asks the whole series by month without edges, and a year by day with both", () => {
    const all = targetOf(requestFor({ family: "pool", pool: "orchard", metric: "balance" }))!;
    expect(all.query).toEqual([["interval", "month"]]);
    const year = targetOf(
      requestFor({ family: "pool", pool: "orchard", metric: "balance", range: "1y" }),
    )!;
    expect(year.query).toEqual([
      ["from", "2025-08-03"],
      ["to", "2026-08-04"],
      ["interval", "day"],
    ]);
  });

  it("declares the same column types as the export layer", () => {
    // A compile-time check that the two closed lists are one list.
    const same: ColumnType extends (typeof EXPORT_COLUMN_TYPES)[number] ? true : false = true;
    const back: (typeof EXPORT_COLUMN_TYPES)[number] extends ColumnType ? true : false = true;
    expect(same && back).toBe(true);
  });
});

/** The CSV the API serves for the same call, split naïvely: the fixture cells hold no commas. */
async function csvRows(v1: V1Requester, card: DataExportCard): Promise<string[][]> {
  const q = new URLSearchParams(card.query);
  q.set("format", "csv");
  const res = await v1.request(`${card.path}?${q.toString()}`);
  expect(res.status).toBe(200);
  return (await res.text())
    .trim()
    .split("\r\n")
    .map((line) => line.split(","));
}

describe("a card from the fixture world", () => {
  const v1 = makeV1();
  const tools = new AgentTools(v1, makeChain(), () => FIXTURE_NOW_MS);
  const ask = (args: Record<string, unknown>, userText = "") =>
    tools.dispatch("export_data", JSON.stringify(args), userText);

  it.each([
    [{ family: "pool", pool: "orchard", metric: "balance", from: "2026-01-01" }],
    [{ family: "pool", pool: "sapling", metric: "notes", range: "30d" }],
    [{ family: "price", range: "1y" }],
    [{ family: "network", metric: "active-addresses", range: "90d" }],
    [{ family: "blocks" }],
    [{ family: "transaction-list", kind: "shielded" }],
    [{ family: "supply-by-pool" }],
    [{ family: "miners", range: "30d" }],
    [{ family: "reorgs" }],
  ])("%j: the preview is the file's first rows", async (args) => {
    const result = await ask(args);
    const card = result.export;
    expect(card, result.content).toBeDefined();
    // It survives the wire exactly as the console parses it.
    expect(parseDataExportCard(JSON.parse(JSON.stringify(card)))).toEqual(card);
    const [header, ...rows] = await csvRows(v1, card!);
    expect(header).toEqual(card!.columns.map((c) => c.name));
    expect(card!.rows).toBe(rows.length);
    card!.preview.forEach((row, i) => {
      const asText = row.map((cell) => (typeof cell === "string" ? cell : ""));
      expect(asText).toEqual(rows[i]);
    });
  });

  it("tells the model what the file is and never the link or the rows", async () => {
    const result = await ask({
      family: "pool",
      pool: "orchard",
      metric: "balance",
      from: "2026-01-01",
    });
    const card = result.export!;
    expect(result.content).toMatch(/<note source="export">/);
    expect(result.content).toContain("orchard_zat");
    expect(result.content).toContain(`${card.rows} rows`);
    expect(result.content).not.toContain(API_BASE_URL);
    expect(result.content).not.toMatch(/https?:|\/v1\/|format=/);
    for (const cell of card.preview.flat()) {
      if (typeof cell === "string" && /^\d{6,}$/.test(cell)) {
        expect(result.content).not.toContain(cell);
      }
    }
    // A card is its own citation: no source link is added for it.
    expect(result.endpoints).toEqual([]);
  });

  it("names the file as the API's own Content-Disposition does", async () => {
    const card = (await ask({ family: "price", range: "30d" })).export!;
    const q = new URLSearchParams(card.query);
    q.set("format", "csv");
    const res = await v1.request(`${card.path}?${q.toString()}`);
    expect(res.headers.get("content-disposition")).toBe(`attachment; filename="${card.fileName}"`);
  });

  it("flags a list that is one page of a longer one", async () => {
    const paged = (await ask({ family: "blocks" })).export!;
    expect(paged.paged).toBe(true);
    expect((await ask({ family: "blocks" })).content).toMatch(/newest page of a longer list/);
  });

  it("says a partial window is partial, with the API's own notes", async () => {
    const result = await ask({ family: "network", metric: "active-addresses", range: "90d" });
    expect(result.export!.coverage).toBe("partial");
    expect(result.content).toMatch(/Coverage is partial: The window includes today's unfinished/);
  });
});

/** A `/v1` that answers the address lookup with a chosen count, and counts its reads. */
function addressV1(answer: { status: number; txCount?: number | null }) {
  const reads: string[] = [];
  const v1: V1Requester = {
    request: (path) => {
      reads.push(path);
      if (path !== `/v1/addresses/${ADDRESS}`) return new Response("{}", { status: 404 });
      const body =
        answer.status === 200
          ? {
              kind: "transparent",
              address: ADDRESS,
              txCount: answer.txCount ?? null,
              ...(answer.txCount === null ? { unknowns: { txCount: "unmeasured" } } : {}),
            }
          : { error: { code: "not_found", message: "no such address" } };
      return new Response(JSON.stringify(body), { status: answer.status });
    },
  };
  return { v1, reads };
}

describe("an address's history", () => {
  const typed = `export the history of ${ADDRESS} as csv`;
  const ask = async (v1: V1Requester, userText = typed) =>
    new AgentTools(v1, makeChain(), () => FIXTURE_NOW_MS).dispatch(
      "export_data",
      JSON.stringify({ family: "address-history", address: ADDRESS }),
      userText,
    );

  it("is offered for a typed transparent address under the cap, read when downloaded", async () => {
    const { v1, reads } = addressV1({ status: 200, txCount: 1_234 });
    const result = await ask(v1);
    const card = result.export!;
    expect(parseDataExportCard(JSON.parse(JSON.stringify(card)))).toEqual(card);
    expect(card.path).toBe(`/v1/addresses/${ADDRESS}/export`);
    expect(card.rows).toBe(1_234);
    expect(card.readOnDownload).toBe(true);
    expect(card.preview).toEqual([]);
    expect(card.fileName).toBe(`shieldedscan_address_${ADDRESS}.csv`);
    // Zeno never walks: the one read is the lookup that bounds the file.
    expect(reads).toEqual([`/v1/addresses/${ADDRESS}`]);
    expect(result.content).toContain("1,234 transactions");
  });

  it("is refused past the cap, in the 422's words, pointing at the open dataset", async () => {
    const { v1 } = addressV1({ status: 200, txCount: ADDRESS_EXPORT_CAP + 1 });
    const result = await ask(v1);
    expect(result.export).toBeUndefined();
    expect(result.content).toMatch(/reason="too-large"/);
    expect(result.content).toContain("an export holds at most 10,000");
    expect(result.endpoints).toEqual(["site:open-dataset"]);
    // The model is never handed a query or a link to retype.
    expect(result.content).not.toMatch(/duckdb|hf:\/\/|huggingface|SELECT/i);
  });

  it("offers exactly the cap", async () => {
    const { v1 } = addressV1({ status: 200, txCount: ADDRESS_EXPORT_CAP });
    expect((await ask(v1)).export?.rows).toBe(ADDRESS_EXPORT_CAP);
  });

  it("is refused, with no figure, when the count cannot be read", async () => {
    const { v1 } = addressV1({ status: 200, txCount: null });
    const result = await ask(v1);
    expect(result.export).toBeUndefined();
    expect(result.content).toMatch(/reason="unavailable"/);
  });

  it.each([
    ["an unknown address", { status: 404 }],
    ["an address with no transactions", { status: 200, txCount: 0 }],
  ])("is refused for %s", async (_name, answer) => {
    const { v1 } = addressV1(answer);
    const result = await ask(v1);
    expect(result.export).toBeUndefined();
    expect(result.content).toMatch(/reason="not-exportable"/);
  });

  it.each([500, 503])("is refused when the lookup answers %i", async (status) => {
    const { v1 } = addressV1({ status });
    const result = await ask(v1);
    expect(result.export).toBeUndefined();
    expect(result.content).toMatch(/reason="unavailable"/);
  });
});
