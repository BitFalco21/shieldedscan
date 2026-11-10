import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { COIN_AGE_BANDS } from "@/domain/coin-age";
import { getCoinAge } from "@/fixtures/coin-age";
import {
  COIN_AGE_STALE_BLOCKS,
  V1_COIN_AGE_PATH,
  monthEndsThrough,
  pointsFromCells,
  v1CoinAgeRoutes,
} from "../v1/coin-age";

/** `/v1/analytics/coin-age`'s HTTP contract over the fixture series, without a database. */

const app = (series = getCoinAge(), tip: number | null = series.latest?.height ?? null) =>
  v1CoinAgeRoutes({
    pool: {} as Pool,
    now: () => 1_790_000_000_000,
    load: async () => series,
    tip: async () => tip,
  });

interface Body {
  query: { from: string | null; to: string | null };
  coverage: { status: string; notes: string[] };
  data: {
    bands: { key: string; label: string }[];
    monthEnds: {
      asOf: string;
      height: number;
      total: { zat: number; zec: string };
      bands: {
        key: string;
        value: { zat: number };
        outputs: number;
        share: { pct: number; numerator: number; denominator: number };
      }[];
    }[];
    latest: Body["data"]["monthEnds"][number] | null;
  };
  unknowns: Record<string, string>;
}

const get = async (q = "", series = getCoinAge(), tip?: number | null) => {
  const res = await app(series, tip).request(`${V1_COIN_AGE_PATH}${q}`);
  return { status: res.status, body: (await res.json()) as Body };
};

describe("/v1/analytics/coin-age", () => {
  it("serves every month-end and the newest block, each band's share against the point's total", async () => {
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(body.data.bands.map((b) => b.key)).toEqual(COIN_AGE_BANDS.map((b) => b.key));
    expect(body.data.monthEnds.length).toBeGreaterThan(100);
    for (const p of [...body.data.monthEnds, body.data.latest!]) {
      const sum = p.bands.reduce((s, b) => s + b.value.zat, 0);
      expect(sum).toBe(p.total.zat);
      for (const b of p.bands) {
        expect(b.share.denominator).toBe(p.total.zat);
        expect(b.share.numerator).toBe(b.value.zat);
      }
    }
  });

  it("cuts the month-ends to the window, half-open, and keeps the newest block", async () => {
    const { body } = await get("?from=2025-01-01&to=2025-04-01");
    expect(body.query).toEqual({ from: "2025-01-01", to: "2025-04-01" });
    expect(body.data.monthEnds.map((p) => p.asOf)).toEqual([
      "2025-01-31",
      "2025-02-28",
      "2025-03-31",
    ]);
    expect(body.data.latest).not.toBeNull();
  });

  it("refuses an unknown parameter and a malformed day", async () => {
    expect((await get("?interval=day")).status).toBe(400);
    expect((await get("?from=2025-13-01")).status).toBe(400);
  });

  it("says partial when the newest point has fallen a day of blocks behind the tip", async () => {
    const series = getCoinAge();
    const at = series.latest!.height;
    const fresh = await get("", series, at + 100 + 24);
    expect(fresh.body.coverage).toEqual({ status: "complete", notes: [] });
    const behind = await get("", series, at + COIN_AGE_STALE_BLOCKS + 1);
    expect(behind.body.coverage.status).toBe("partial");
    expect(behind.body.coverage.notes.join(" ")).toMatch(/fallen behind/);
    expect(behind.body.data.latest!.height).toBe(at);
  });

  it("says the series is unmeasured before it is computed, never zero", async () => {
    const { status, body } = await get("", { monthEnds: [], latest: null });
    expect(status).toBe(200);
    expect(body.data.latest).toBeNull();
    expect(body.unknowns["data.latest"]).toBe("unmeasured");
  });
});

describe("coin age reading", () => {
  it("lists every month-end through the last closed day", () => {
    expect(monthEndsThrough("2016-10-28", "2016-12-30")).toEqual(["2016-10-31", "2016-11-30"]);
    expect(monthEndsThrough("2024-01-15", "2024-02-29")).toEqual(["2024-01-31", "2024-02-29"]);
  });

  it("bands each day's cells at that day, a day with none all zeros", () => {
    const points = pointsFromCells(
      [
        { asOf: "2026-10-31", creationDay: "2026-10-30", valueZat: 5, outputs: 1 },
        { asOf: "2026-10-31", creationDay: "2019-01-01", valueZat: 9, outputs: 2 },
      ],
      new Map([
        ["2026-10-31", 100],
        ["2026-09-30", 50],
      ]),
    );
    expect(points.map((p) => [p.asOf, p.height])).toEqual([
      ["2026-09-30", 50],
      ["2026-10-31", 100],
    ]);
    expect(points[0]!.bands.every((b) => b.valueZat === 0)).toBe(true);
    expect(points[1]!.bands.find((b) => b.key === "lt1w")?.valueZat).toBe(5);
    expect(points[1]!.bands.find((b) => b.key === "5y")?.valueZat).toBe(9);
  });
});
