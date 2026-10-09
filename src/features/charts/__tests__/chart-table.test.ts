import { describe, expect, it } from "vitest";
import { fixtureDataSource } from "@/data/fixture-source";
import { utcDayFromSeconds, type SupplyDayPoint } from "@/domain";
import { API_GROUPS } from "@/api-catalogue";
import { loadChartData } from "@/app/_shared/load-chart-data";
import { CHART_CATEGORIES, CHARTS, VISIBLE_CHARTS, relatedCharts } from "../catalog";
import { chartData } from "../chart-data";
import { chartPreview, sampleEvenly, SPARK_POINTS } from "../chart-preview";
import { chartCsv, chartTable, runningMonth } from "../chart-table";

const DAY = 86_400;

describe("every chart's table", async () => {
  const data = await loadChartData(
    fixtureDataSource,
    VISIBLE_CHARTS.map((c) => c.slug),
  );

  for (const { slug } of VISIBLE_CHARTS) {
    it(`${slug}: a header, then one well-formed row per period, oldest first`, () => {
      const t = chartTable(slug, data, "all");
      expect(t, slug).not.toBeNull();
      expect(t!.rows.length).toBeGreaterThan(0);
      for (const row of t!.rows) expect(row).toHaveLength(t!.columns.length);
      for (let i = 1; i < t!.timestamps.length; i++) {
        expect(t!.timestamps[i]!).toBeGreaterThanOrEqual(t!.timestamps[i - 1]!);
      }
      const csv = chartCsv(t!).trimEnd().split("\n");
      expect(csv[0]).toBe([t!.period, ...t!.columns].join(","));
      expect(csv).toHaveLength(t!.rows.length + 1);
    });
  }

  it("is null exactly when the series is unreadable, as the chart says unavailable", () => {
    for (const { slug } of VISIBLE_CHARTS)
      expect(chartTable(slug, chartData({}), "all")).toBeNull();
  });
});

describe("the CSV", () => {
  it("prints a gap as an empty field, never as zero", () => {
    const network = [
      { timestamp: 1_700_000_000, avgDifficulty: 5, avgBlockBytes: 100 },
      { timestamp: 1_700_000_000 + DAY, avgDifficulty: null, avgBlockBytes: 120 },
    ];
    const csv = chartCsv(chartTable("difficulty", chartData({ network } as never), "all")!);
    expect(csv).toBe("day,avg_difficulty\n2023-11-14,5\n2023-11-15,\n");
  });
});

describe("previews", () => {
  it("samples at most SPARK_POINTS points, keeping the first and the newest", () => {
    const rows = Array.from({ length: 1000 }, (_, i) => i);
    const s = sampleEvenly(rows, SPARK_POINTS);
    expect(s).toHaveLength(SPARK_POINTS);
    expect(s[0]).toBe(0);
    expect(s.at(-1)).toBe(999);
  });

  it("reads a daily headline from the last complete day, never from today's partial one", () => {
    const now = Date.parse("2026-10-09T12:00:00Z") / 1000;
    const point = (ts: number, txs: number) => ({
      timestamp: ts,
      topHeight: 1,
      transparentTxs: txs,
      mixedTxs: 0,
      shieldedTxs: 0,
      sproutZat: 0,
      saplingZat: 0,
      orchardZat: 0,
      ironwoodZat: 0,
    });
    const days = [point(now - 2 * DAY, 500), point(now - DAY, 700), point(now, 3)];
    const p = chartPreview("transactions-by-kind", chartData({ days, months: days }), now);
    expect(p.headline).toEqual({
      value: "700",
      caption: `transactions, ${utcDayFromSeconds(now - DAY)}`,
    });
  });

  it("shows no fee headline for a day whose blocks are not all covered", () => {
    const now = Date.parse("2026-10-09T12:00:00Z") / 1000;
    const feeTotals = {
      monthly: [],
      daily: [{ timestamp: now - DAY, feeZat: 1_000, blocks: 1_150, blocksCovered: 1_100 }],
    };
    expect(chartPreview("fee-totals", chartData({ feeTotals } as never), now).headline).toBeNull();
  });

  it("carries neither a figure nor a shape when the series is unreadable", () => {
    expect(chartPreview("price", chartData({}), 0)).toEqual({ thumb: null, headline: null });
  });
});

describe("the catalogue", () => {
  const documented = new Map(API_GROUPS.flatMap((g) => g.endpoints).map((e) => [e.id, e.path]));

  it("points every chart at a documented public endpoint serving it, or says it has none", () => {
    for (const c of CHARTS) {
      if (c.api === null) {
        // The series the public API does not carry yet: no endpoint serves the release record, or
        // the transparent and lockbox balances by day. Each page says so.
        expect(["upgrade-readiness", "shielded-share", "lockbox-balance"]).toContain(c.slug);
        continue;
      }
      expect(documented.get(c.api.docsId), c.slug).toBe(c.api.path);
    }
  });

  it("files every chart under a known category", () => {
    for (const c of VISIBLE_CHARTS) expect(CHART_CATEGORIES).toContain(c.category);
  });

  it("suggests three other charts, its own category first", () => {
    const related = relatedCharts("pool-usage");
    expect(related).toHaveLength(3);
    expect(related.map((c) => c.slug)).not.toContain("pool-usage");
    expect(related[0]!.category).toBe("Privacy");
  });
});

describe("the newer charts' tables", () => {
  it("states each day's target from its heights, and none on Blossom's activation day", () => {
    const blocksDaily = [
      { timestamp: 1_575_936_000, blocks: 576, topHeight: 652_000 },
      { timestamp: 1_576_022_400, blocks: 628, topHeight: 653_700 },
      { timestamp: 1_576_108_800, blocks: 1_152, topHeight: 654_852 },
    ];
    const t = chartTable("blocks-per-day", chartData({ blocksDaily }), "all")!;
    expect(t.rows.map((r) => r[1])).toEqual([576, null, 1_152]);
  });

  it("states miner shares against every block in the month", () => {
    const minerShares = [
      {
        timestamp: 1_700_000_000,
        blocks: 1_000,
        days: 30,
        top1Blocks: 333,
        top3Blocks: 700,
        top10Blocks: 950,
        shieldedBlocks: 30,
      },
      {
        timestamp: 1_702_600_000,
        blocks: 0,
        days: 0,
        top1Blocks: 0,
        top3Blocks: 0,
        top10Blocks: 0,
        shieldedBlocks: 0,
      },
    ];
    const t = chartTable("miner-concentration", chartData({ minerShares }), "30d")!;
    // No range on a monthly series: the request for 30 days still returns every month.
    expect(t.rows).toHaveLength(2);
    expect(t.rows[0]!.slice(0, 4)).toEqual([33.3, 70, 95, 3]);
    // A month with no blocks has no share: null, never 0%.
    expect(t.rows[1]![0]).toBeNull();
  });

  it("finds a month still running at the time the data was read, and only then", () => {
    const sep = Date.UTC(2026, 8, 1) / 1000;
    const oct = Date.UTC(2026, 9, 1) / 1000;
    const chainInflow = [
      { timestamp: sep, chain: "BTC", inZat: 100 },
      { timestamp: oct, chain: "BTC", inZat: 10 },
    ];
    const t = chartTable("inflow-by-chain", chartData({ chainInflow }), "all")!;
    const ninthOfOct = Date.UTC(2026, 9, 9, 12) / 1000;
    expect(runningMonth(t, ninthOfOct)).toEqual({ index: 1, throughDay: 9 });
    // Read in November, October had ended: nothing is partial.
    expect(runningMonth(t, Date.UTC(2026, 10, 2) / 1000)).toBeNull();
    // An unknown read time claims nothing.
    expect(runningMonth(t, 0)).toBeNull();
  });

  it("draws the largest source chains on their own and folds the rest", () => {
    const chainInflow = ["BTC", "ETH", "SOL", "TRX", "BASE", "ARB", "DOGE", "LTC"].flatMap(
      (chain, i) => [
        { timestamp: 1_700_000_000, chain, inZat: (8 - i) * 1_000 },
        { timestamp: 1_702_600_000, chain, inZat: (8 - i) * 100 },
      ],
    );
    const t = chartTable("inflow-by-chain", chartData({ chainInflow }), "all")!;
    expect(t.keys).toEqual(["BTC", "ETH", "SOL", "TRX", "BASE", "ARB", "OTHER"]);
    // DOGE and LTC fold into OTHER: 2,000 + 1,000 in the first month.
    expect(t.rows[0]!.at(-1)).toBe(3_000);
    // Every row partitions the month's inbound: nothing dropped in the fold.
    expect(t.rows[0]!.reduce((a, b) => a! + b!, 0)).toBe(36_000);
  });

  it("folds destination chains the same way, from outbound swaps", () => {
    const chainOutflow = [
      { timestamp: Date.UTC(2026, 6, 1) / 1000, chain: "ETH", outZat: 500 },
      { timestamp: Date.UTC(2026, 8, 1) / 1000, chain: "BTC", outZat: 200 },
    ];
    const t = chartTable("outflow-by-chain", chartData({ chainOutflow }), "all")!;
    expect(t.columns).toEqual(["eth_out_zat", "btc_out_zat"]);
    // August had no outbound swap: a measured zero, so the months keep their spacing.
    expect(t.rows).toEqual([
      [500, 0],
      [0, 0],
      [0, 200],
    ]);
  });

  it("adds each venue's two directions: what it carried, never a net", () => {
    const venueMonths = [
      { timestamp: 1_700_000_000, protocol: "maya", inZat: 30, outZat: 70 },
      { timestamp: 1_700_000_000, protocol: "near-intents", inZat: 400, outZat: 600 },
    ];
    const t = chartTable("volume-by-venue", chartData({ venueMonths }), "all")!;
    expect(t.keys).toEqual(["near-intents", "maya"]);
    expect(t.columns).toEqual(["near_intents_zat", "maya_zat"]);
    expect(t.rows[0]).toEqual([1_000, 100]);
  });

  it("counts Sapling and unified as shielded-capable, and leaves unclassified out of both sides", () => {
    const sep = Date.UTC(2026, 8, 1) / 1000;
    const nov = Date.UTC(2026, 10, 1) / 1000;
    const inflowKinds = [
      { timestamp: sep, kind: "transparent" as const, transfers: 6, zat: 600 },
      { timestamp: sep, kind: "unified" as const, transfers: 3, zat: 300 },
      { timestamp: sep, kind: "sapling" as const, transfers: 1, zat: 1_100 },
      { timestamp: sep, kind: null, transfers: 90, zat: 9_000 },
      { timestamp: nov, kind: "transparent" as const, transfers: 1, zat: 1 },
    ];
    const t = chartTable("shielded-capable-swaps", chartData({ inflowKinds }), "all")!;
    // 4 of 10 classified swaps; 1,400 of 2,000 classified zatoshis.
    expect(t.rows[0]!.slice(0, 2)).toEqual([40, 70]);
    expect(t.rows[0]!.slice(2)).toEqual([4, 10, 1_400, 2_000]);
    // October saw no swap at all: no share, never 0%.
    expect(t.rows[1]).toEqual([null, null, null, null, null, null]);
    expect(t.rows[2]!.slice(0, 2)).toEqual([0, 0]);
  });

  const supplyDay = (day: number, over: Partial<SupplyDayPoint> = {}): SupplyDayPoint => ({
    timestamp: Date.UTC(2026, 0, day) / 1000,
    transparentZat: 700,
    sproutZat: 100,
    saplingZat: 200,
    orchardZat: null,
    ironwoodZat: null,
    lockboxZat: null,
    ...over,
  });

  it("states the shielded share against circulating supply, a pool not yet existing as empty", () => {
    const supplyDays = [supplyDay(1), supplyDay(2, { orchardZat: 300, lockboxZat: 5_000 })];
    const t = chartTable("shielded-share", chartData({ supplyDays }), "30d")!;
    // 300 of 1,000; then 600 of 1,300, the lockbox in neither side.
    expect(t.rows.map((r) => r[0])).toEqual([30, 46.15]);
    expect(t.rows[1]!.slice(1)).toEqual([600, 1_300]);
    // An unread transparent balance has no share: never one computed over a missing side.
    const unread = chartTable(
      "shielded-share",
      chartData({ supplyDays: [supplyDay(1, { transparentZat: null }), supplyDay(2)] }),
      "30d",
    )!;
    expect(unread.rows[0]).toEqual([null, null, null]);
  });

  it("reads the whole history at each month's close", () => {
    const supplyDays = [
      supplyDay(30, { saplingZat: 0 }),
      supplyDay(31, { saplingZat: 300 }),
      supplyDay(32, { saplingZat: 900 }),
    ];
    const t = chartTable("shielded-share", chartData({ supplyDays }), "all")!;
    expect(t.period).toBe("month");
    // January closes on the 31st, February (the 32nd of January) on its only day.
    expect(t.timestamps).toEqual([Date.UTC(2026, 0, 1) / 1000, Date.UTC(2026, 1, 1) / 1000]);
    expect(t.rows.map((r) => r[1])).toEqual([400, 1_000]);
  });

  it("starts the lockbox on the day NU6 created it, not as an empty lockbox before", () => {
    const supplyDays = [
      supplyDay(1),
      supplyDay(2, { lockboxZat: 10 }),
      supplyDay(3, { lockboxZat: 20 }),
    ];
    const t = chartTable("lockbox-balance", chartData({ supplyDays }), "all")!;
    expect(t.rows).toEqual([[10], [20]]);
  });
});
