import { describe, expect, it } from "vitest";
import { priorPeriodStart, withPoolBalanceChanges, withThroughput } from "../tools/enrich";

/**
 * Figures handed over so a common question needs no calculator round: a period's transaction total
 * and a balance series' change from one point to the next.
 */

const zat = (n: number) => ({ zat: n, zec: String(n / 1e8) });

describe("a window's transaction total", () => {
  it("is the three kinds' sum on every bucket, today's included", () => {
    const day = Date.UTC(2026, 10, 5) / 1000;
    const out = withThroughput(
      {
        totals: { transparentTxs: 10, mixedTxs: 5, shieldedTxs: 7, daysCovered: 1, timestamp: day },
        groups: [
          { transparentTxs: 1, mixedTxs: 2, shieldedTxs: 3, daysCovered: 1, timestamp: day },
          {
            transparentTxs: 4,
            mixedTxs: 0,
            shieldedTxs: 0,
            daysCovered: 1,
            timestamp: day + 86_400,
          },
        ],
      },
      Date.UTC(2026, 10, 6, 12),
    ) as { totals: { totalTxs: number }; groups: { totalTxs: number }[] };
    expect(out.totals.totalTxs).toBe(22);
    expect(out.groups.map((g) => g.totalTxs)).toEqual([6, 4]);
  });

  it("is absent when a kind is unknown, never a sum of what is known", () => {
    const out = withThroughput(
      { totals: { transparentTxs: 10, mixedTxs: null, shieldedTxs: 7, daysCovered: 1 } },
      Date.UTC(2026, 10, 6),
    ) as { totals: Record<string, unknown> };
    expect(out.totals).not.toHaveProperty("totalTxs");
  });
});

describe("a pool-balance series' changes", () => {
  it("starts one period earlier, months by calendar", () => {
    expect(priorPeriodStart("2026-03-01", "month")).toBe("2026-02-01");
    expect(priorPeriodStart("2026-03-17", "month")).toBe("2026-02-01");
    expect(priorPeriodStart("2026-01-01", "month")).toBe("2025-12-01");
    expect(priorPeriodStart("2026-03-01", "day")).toBe("2026-02-28");
  });

  it("gives each point its change from the one before, and marks the baseline", () => {
    const out = (
      withPoolBalanceChanges(
        {
          data: {
            points: [
              {
                periodStart: "2026-01-01",
                pools: { sapling: zat(1000), orchard: zat(50) },
                totalShielded: zat(1050),
              },
              {
                periodStart: "2026-02-01",
                pools: { sapling: zat(900), orchard: zat(80) },
                totalShielded: zat(980),
              },
            ],
          },
        },
        "2026-02-01",
        "month",
      ) as { data: { points: Record<string, unknown>[] } }
    ).data;
    expect(out.points[0]).toMatchObject({ baselineOnly: true });
    expect(out.points[0]).not.toHaveProperty("changeFromPrevious");
    expect(out.points[1]).not.toHaveProperty("baselineOnly");
    expect(out.points[1]!.changeFromPrevious).toEqual({
      pools: { sapling: { changeZat: -100 }, orchard: { changeZat: 30 } },
      totalShielded: { changeZat: -70 },
    });
  });

  it("marks no baseline on an open window, and names an unreadable change null", () => {
    const out = (
      withPoolBalanceChanges(
        {
          data: {
            points: [
              { pools: { sapling: null }, totalShielded: zat(1) },
              { pools: { sapling: zat(5) }, totalShielded: zat(2) },
            ],
          },
        },
        null,
        "month",
      ) as { data: { points: Record<string, unknown>[] } }
    ).data;
    expect(out.points[0]).not.toHaveProperty("baselineOnly");
    expect(out.points[1]!.changeFromPrevious).toEqual({
      pools: { sapling: null },
      totalShielded: { changeZat: 1 },
    });
  });

  it("marks no baseline when the series starts at or after the asked day (a window from launch)", () => {
    const out = (
      withPoolBalanceChanges(
        {
          data: {
            points: [
              { periodStart: "2016-10-01", pools: { sprout: zat(1) }, totalShielded: zat(1) },
              { periodStart: "2016-11-01", pools: { sprout: zat(5) }, totalShielded: zat(5) },
            ],
          },
        },
        "2016-10-28",
        "month",
      ) as { data: { points: Record<string, unknown>[] } }
    ).data;
    expect(out.points[0]).not.toHaveProperty("baselineOnly");
  });
});
