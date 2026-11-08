import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { NU7_HEIGHT, type NsmOverview, type SupplyBreakdown } from "@/domain";
import { loadNsmDays, NSM_DAYS_SQL, nsmDaysOf, type NsmDayRow } from "../miners-nsm";
import { minersRoutes } from "../miners-routes";

/**
 * The NSM read against a fake pool that answers by query, and its route against a fake node.
 * What it guards: an unknown fee or a missing block leaves a day unknown, never short; today is
 * never priced at a close; and a node that does not answer costs the balance alone.
 */

/** NU7's block: 2026-11-06 02:34:02 UTC. */
const ACTIVATION_TS = Date.UTC(2026, 10, 6, 2, 34, 2) / 1000;
const NOV_6 = Date.UTC(2026, 10, 6) / 1000;
/** Noon on 2026-11-08. */
const NOW = Date.UTC(2026, 10, 8, 12) / 1000;

const ROWS: NsmDayRow[] = [
  {
    day: "2026-11-06",
    blocks: 3,
    lo: NU7_HEIGHT,
    hi: NU7_HEIGHT + 2,
    fee_blocks: 3,
    fees: "1000",
    nsm: "600",
  },
  {
    day: "2026-11-07",
    blocks: 2,
    lo: NU7_HEIGHT + 3,
    hi: NU7_HEIGHT + 4,
    fee_blocks: 2,
    fees: "15",
    nsm: "8",
  },
  {
    day: "2026-11-08",
    blocks: 1,
    lo: NU7_HEIGHT + 5,
    hi: NU7_HEIGHT + 5,
    fee_blocks: 1,
    fees: "10",
    nsm: "6",
  },
];

interface FakeDb {
  activation?: number;
  rows?: NsmDayRow[];
  held?: number;
  closes?: { day: string; usd: number }[];
}

/** A pool that answers each of the read's queries, and records the parameters it was given. */
function fakePool(db: FakeDb, seen: unknown[][] = []): Pool {
  const query = async (sql: string, params: unknown[] = []) => {
    seen.push(params);
    if (sql.includes("WHERE height = $1")) {
      return { rows: db.activation === undefined ? [] : [{ timestamp: String(db.activation) }] };
    }
    if (sql === NSM_DAYS_SQL) return { rows: db.rows ?? ROWS };
    if (sql.includes("zec_price_daily")) return { rows: db.closes ?? [] };
    if (sql.includes("BETWEEN")) return { rows: [{ n: db.held ?? 6 }] };
    throw new Error(`unexpected query: ${sql}`);
  };
  return { query } as unknown as Pool;
}

describe("nsmDaysOf", () => {
  const closes = new Map([
    ["2026-11-06", 500],
    ["2026-11-08", 510],
  ]);

  it("passes known days through, and never prices today at a close", () => {
    const days = nsmDaysOf(ROWS, closes, "2026-11-08", true);
    expect(days[0]).toEqual({
      day: "2026-11-06",
      blocks: 3,
      feeZat: 1000,
      nsmZat: 600,
      closeUsd: 500,
      partial: false,
    });
    expect(days[1]!.closeUsd).toBeNull();
    expect(days[2]).toMatchObject({ partial: true, closeUsd: null, nsmZat: 6 });
  });

  it("leaves a day with one unknown fee unknown, never a partial sum", () => {
    const rows = [{ ...ROWS[0]!, fee_blocks: 2, fees: "900", nsm: "540" }];
    const [d] = nsmDaysOf(rows, closes, "2026-11-08", true);
    expect(d!.feeZat).toBeNull();
    expect(d!.nsmZat).toBeNull();
    expect(d!.blocks).toBe(3);
  });

  it("leaves every day unknown when the index has a gap", () => {
    const days = nsmDaysOf(ROWS, closes, "2026-11-08", false);
    expect(days.every((d) => d.feeZat === null && d.nsmZat === null)).toBe(true);
  });
});

describe("loadNsmDays", () => {
  it("reads from activation's midnight while NU7 is younger than the series", async () => {
    const seen: unknown[][] = [];
    const o = await loadNsmDays(
      fakePool({ activation: ACTIVATION_TS, closes: [{ day: "2026-11-06", usd: 500 }] }, seen),
      NOW,
    );
    expect(o.activationDay).toBe("2026-11-06");
    expect(o.activationHeight).toBe(NU7_HEIGHT);
    expect(o.days.map((d) => d.nsmZat)).toEqual([600, 8, 6]);
    expect(o.days[0]!.closeUsd).toBe(500);
    // The days query, by height from NU7 and from activation's midnight.
    expect(seen).toContainEqual([NU7_HEIGHT, NOV_6]);
    // Closes up to yesterday: today's bar is not a close.
    expect(seen).toContainEqual(["2026-11-06", "2026-11-08"]);
  });

  it("trails the last 90 days once NU7 is older", async () => {
    const seen: unknown[][] = [];
    const later = NOW + 200 * 86_400;
    await loadNsmDays(fakePool({ activation: ACTIVATION_TS, rows: [] }, seen), later);
    const today = Math.floor(later / 86_400) * 86_400;
    expect(seen).toContainEqual([NU7_HEIGHT, today - 89 * 86_400]);
  });

  it("has no days before the index holds the activation block", async () => {
    const o = await loadNsmDays(fakePool({}), NOW);
    expect(o).toEqual({ activationHeight: NU7_HEIGHT, activationDay: null, days: [] });
  });

  it("leaves every day unknown when a height in the span is missing", async () => {
    const o = await loadNsmDays(fakePool({ activation: ACTIVATION_TS, held: 5 }), NOW);
    expect(o.days.every((d) => d.nsmZat === null)).toBe(true);
  });

  it("leaves every day unknown when the series from activation does not start at NU7", async () => {
    const rows = ROWS.map((r) => ({ ...r, lo: r.lo + 1, hi: r.hi + 1 }));
    const o = await loadNsmDays(fakePool({ activation: ACTIVATION_TS, rows }), NOW);
    expect(o.days.every((d) => d.nsmZat === null)).toBe(true);
  });
});

describe("GET /chain/miners/nsm", () => {
  const supply =
    (over: Partial<SupplyBreakdown> = {}) =>
    async (): Promise<SupplyBreakdown> => ({
      pools: [],
      height: NU7_HEIGHT + 6,
      nsmZat: 614,
      ...over,
    });
  const get = async (deps: Parameters<typeof minersRoutes>[0]) => {
    const res = await minersRoutes({ now: () => NOW * 1000, ...deps }).request("/chain/miners/nsm");
    expect(res.status).toBe(200);
    return (await res.json()) as NsmOverview;
  };
  const pool = () => fakePool({ activation: ACTIVATION_TS });

  it("pairs the index's days with the node's balance", async () => {
    const body = await get({ pool: pool(), supply: supply() });
    expect(body.balance).toEqual({ height: NU7_HEIGHT + 6, zat: 614 });
    expect(body.days).toHaveLength(3);
  });

  it("states an unreported balance after NU7 as unknown, never zero", async () => {
    const body = await get({ pool: pool(), supply: supply({ nsmZat: null }) });
    expect(body.balance).toEqual({ height: NU7_HEIGHT + 6, zat: null });
  });

  it("answers the days when the node does not, with no balance", async () => {
    const logged: string[] = [];
    const body = await get({
      pool: pool(),
      supply: async () => {
        throw new Error("node timeout");
      },
      log: (m) => logged.push(m),
    });
    expect(body.balance).toBeNull();
    expect(body.days).toHaveLength(3);
    expect(logged.join()).toMatch(/node timeout/);
  });
});
