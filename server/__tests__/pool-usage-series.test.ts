import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import type { PoolUsageRow } from "../pool-usage";
import { buildPoolUsage, parseSeriesWindow, v1SeriesRoutes } from "../v1/analytics-series";

/**
 * `/v1/analytics/pool-usage`: counts are FLOWS and sum per period; the note tree size is a LEVEL
 * taken at the period's close; notes created is the difference of two closes, so it needs the
 * close BEFORE the period too. Each rule has a case here that a wrong implementation fails.
 */

const DAY = 86_400;
const d = (iso: string) =>
  Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 1000;

function row(day: string, pool: PoolUsageRow["pool"], over: Partial<PoolUsageRow>): PoolUsageRow {
  return {
    day: d(day),
    pool,
    txs: 0,
    fullyShielded: 0,
    mixed: 0,
    shielding: 0,
    unshielding: 0,
    indeterminate: 0,
    coinbase: 0,
    spends: pool === "sapling" ? 0 : null,
    outputs: pool === "sapling" ? 0 : null,
    actions: pool === "orchard" || pool === "ironwood" ? 0 : null,
    joinsplits: pool === "sprout" ? 0 : null,
    notesAtClose: null,
    closeHeight: null,
    ...over,
  };
}

const ROWS: PoolUsageRow[] = [
  row("2026-08-31", "ironwood", { txs: 5, notesAtClose: 1_000, closeHeight: 10 }),
  row("2026-09-01", "ironwood", {
    txs: 10,
    fullyShielded: 6,
    mixed: 3,
    shielding: 2,
    unshielding: 1,
    coinbase: 1,
    actions: 40,
    notesAtClose: 1_040,
    closeHeight: 20,
  }),
  row("2026-09-02", "ironwood", {
    txs: 4,
    fullyShielded: 4,
    actions: 9,
    notesAtClose: 1_049,
    closeHeight: 30,
  }),
  row("2026-10-01", "ironwood", { txs: 1, actions: 2, notesAtClose: 1_051, closeHeight: 40 }),
  row("2026-09-01", "sprout", { txs: 1, mixed: 1, unshielding: 1, joinsplits: 1 }),
  row("2026-09-02", "sprout", {}),
  row("2026-10-01", "sprout", {}),
];

const NOW = d("2026-10-04") + 3_600;

describe("buildPoolUsage", () => {
  it("sums counts per day and measures notes created from the previous close", () => {
    const w = parseSeriesWindow({ from: "2026-09-01", to: "2026-09-03", interval: "day" });
    const { data } = buildPoolUsage(ROWS, w, ["ironwood"], NOW);
    expect(data.points.map((p) => p.periodStart)).toEqual(["2026-09-01", "2026-09-02"]);
    const sep1 = data.points[0]!.pools.ironwood!;
    expect(sep1.transactions).toEqual({
      total: 10,
      fullyShielded: 6,
      mixed: 3,
      coinbase: 1,
      mixedByDirection: { shielding: 2, unshielding: 1, indeterminate: 0 },
    });
    expect(sep1.bundle).toEqual({ actions: 40 });
    // 1,040 at the close of Sep 1 minus 1,000 at the close of Aug 31 — a day OUTSIDE the window.
    expect(sep1.notes).toEqual({
      atClose: 1_040,
      created: 40,
      closeDay: "2026-09-01",
      closeHeight: 20,
    });
    expect(data.totals.ironwood!.transactions.total).toBe(14);
    expect(data.totals.ironwood!.notes.created).toBe(49);
  });

  it("takes a month's notes at its closing day and never sums the level", () => {
    const w = parseSeriesWindow({ from: "2026-09-01", to: "2026-11-01", interval: "month" });
    const { data } = buildPoolUsage(ROWS, w, ["ironwood"], NOW);
    expect(data.points.map((p) => [p.periodStart, p.pools.ironwood!.notes.atClose])).toEqual([
      ["2026-09-01", 1_049],
      ["2026-10-01", 1_051],
    ]);
    expect(data.points[1]!.pools.ironwood!.notes.created).toBe(2);
  });

  it("states Sprout's missing tree as unmeasured, never as zero notes", () => {
    const w = parseSeriesWindow({ from: "2026-09-01", to: "2026-09-02", interval: "day" });
    const { data, unknowns } = buildPoolUsage(ROWS, w, ["sprout"], NOW);
    expect(data.points[0]!.pools.sprout!.notes.atClose).toBeNull();
    expect(data.points[0]!.pools.sprout!.bundle).toEqual({ joinsplits: 1 });
    expect(unknowns["data.points.0.pools.sprout.notes.atClose"]).toBe("unmeasured");
    expect(unknowns["data.points.0.pools.sprout.notes.created"]).toBe("unmeasured");
  });

  it("counts a pool's first notes from empty, and calls the days before it nonexistent", () => {
    // Ironwood's tree first appears on 2026-07-28 (activation) in this slice.
    const slice: PoolUsageRow[] = [
      row("2026-07-27", "ironwood", {}),
      row("2026-07-28", "ironwood", { txs: 2, actions: 6, notesAtClose: 6, closeHeight: 1 }),
      row("2026-07-29", "ironwood", { txs: 1, actions: 4, notesAtClose: 10, closeHeight: 2 }),
    ];
    const day = parseSeriesWindow({ from: "2026-07-27", to: "2026-07-30", interval: "day" });
    const { data, unknowns } = buildPoolUsage(slice, day, ["ironwood"], NOW);
    expect(data.points.map((p) => p.pools.ironwood!.notes.created)).toEqual([null, 6, 4]);
    expect(unknowns["data.points.0.pools.ironwood.notes.atClose"]).toBe("nonexistent");
    expect(unknowns["data.points.1.pools.ironwood.notes.created"]).toBeUndefined();
    // A month that begins before the pool existed counts from empty too.
    const month = parseSeriesWindow({ from: "2026-07-01", to: "2026-08-01", interval: "month" });
    expect(
      buildPoolUsage(slice, month, ["ironwood"], NOW).data.points[0]!.pools.ironwood!.notes,
    ).toMatchObject({ atClose: 10, created: 10 });
  });

  it("says when the window reaches today, or days not computed yet", () => {
    const w = parseSeriesWindow({ from: "2026-09-01", to: "2026-09-05", interval: "day" });
    const { coverage } = buildPoolUsage(ROWS, w, ["ironwood"], NOW);
    expect(coverage.status).toBe("partial");
    expect(coverage.notes.join(" ")).toMatch(/2 day\(s\) in this window are not computed yet/);
    const today = parseSeriesWindow({ from: "2026-10-01", interval: "month" });
    expect(buildPoolUsage(ROWS, today, ["ironwood"], NOW).coverage.notes.join(" ")).toMatch(
      /today's unfinished UTC day/,
    );
  });
});

describe("/v1/analytics/pool-usage", () => {
  const app = () =>
    v1SeriesRoutes({
      pool: {
        query: async (sql: string) => {
          if (!sql.includes("FROM pool_usage_daily")) throw new Error(`unexpected read: ${sql}`);
          return {
            rows: ROWS.map((r) => ({
              day: r.day,
              pool: r.pool,
              txs: r.txs,
              fully_shielded: r.fullyShielded,
              mixed: r.mixed,
              shielding: r.shielding,
              unshielding: r.unshielding,
              indeterminate: r.indeterminate,
              coinbase: r.coinbase,
              spends: r.spends,
              outputs: r.outputs,
              actions: r.actions,
              joinsplits: r.joinsplits,
              notes_at_close: r.notesAtClose,
              close_height: r.closeHeight,
            })),
          };
        },
      } as unknown as Pool,
      ironwoodActivationHeight: 3_428_143,
      now: () => NOW * 1000,
    });

  it("answers one pool when asked and echoes the query", async () => {
    const res = await app().request(
      "/v1/analytics/pool-usage?from=2026-09-01&to=2026-09-03&interval=day&pool=ironwood",
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.query.pool).toEqual(["ironwood"]);
    expect(Object.keys(body.data.points[0].pools)).toEqual(["ironwood"]);
  });

  it("refuses an unknown pool and an unknown parameter by name", async () => {
    for (const q of ["pool=transparent", "pools=ironwood"]) {
      const res = await app().request(`/v1/analytics/pool-usage?${q}`);
      expect(res.status, q).toBe(400);
    }
  });

  it("spans whole periods without a day outside the window leaking in", async () => {
    const res = await app().request(
      `/v1/analytics/pool-usage?from=2026-09-02&to=2026-09-03&interval=day&pool=ironwood`,
    );
    const body = await res.json();
    expect(body.data.totals.ironwood.transactions.total).toBe(4);
    expect(body.data.totals.ironwood.notes.created).toBe(9);
    expect(DAY).toBe(86_400);
  });
});
