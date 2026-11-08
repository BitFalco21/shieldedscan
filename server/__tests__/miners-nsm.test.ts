import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { NU7_HEIGHT, REISSUANCE_START_HEIGHT, type NsmOverview } from "@/domain";
import {
  loadNsmDays,
  loadNsmPrefix,
  NSM_DAYS_SQL,
  NSM_SPAN_SQL,
  nsmCarriedInZat,
  nsmDaysOf,
  type NsmDayRow,
} from "../miners-nsm";
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
  /** The stored blocks from NU7 on, height to fee (null: unknown), for the carried-in read. */
  fees?: Map<number, number | null>;
  /** A stored block's hash, when not `h<height>`. */
  hashes?: Map<number, string>;
}

/** Blocks NU7..NU7+205, each with a 10-zat fee, of which the NSM takes 6. */
const CHAIN = new Map(Array.from({ length: 206 }, (_, i) => [NU7_HEIGHT + i, 10 as number | null]));
/** What the NSM held before NU7's first fee: the open dataset's underclaim. */
const CARRIED = 36_858_445_520;

/** A pool that answers each of the read's queries, and records the parameters it was given. */
function fakePool(db: FakeDb, seen: unknown[][] = []): Pool {
  const query = async (sql: string, params: unknown[] = []) => {
    seen.push(params);
    if (sql === NSM_SPAN_SQL) {
      const [after, upTo] = params as [number, number];
      const inSpan = [...(db.fees ?? CHAIN)].filter(([h]) => h > after && h <= upTo);
      const known = inSpan.filter(([, f]) => f !== null);
      const nsm = known.reduce((sum, [, f]) => sum + Math.floor((f! * 6) / 10), 0);
      return { rows: [{ n: inSpan.length, known: known.length, nsm: String(nsm) }] };
    }
    if (sql.startsWith("SELECT max(height)"))
      return { rows: [{ h: Math.max(...(db.fees ?? CHAIN).keys()) }] };
    if (sql.startsWith("SELECT hash")) {
      const h = params[0] as number;
      return { rows: (db.fees ?? CHAIN).has(h) ? [{ hash: db.hashes?.get(h) ?? `h${h}` }] : [] };
    }
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

describe("nsmCarriedInZat", () => {
  const tip = (over: Partial<{ height: number; hash: string; nsmZat: number | null }> = {}) => ({
    height: NU7_HEIGHT + 205,
    hash: `h${NU7_HEIGHT + 205}`,
    nsmZat: CARRIED + 206 * 6,
    ...over,
  });
  const carried = async (db: FakeDb, t = tip()) => {
    const pool = fakePool(db);
    return nsmCarriedInZat(pool, await loadNsmPrefix(pool), t);
  };

  it("is the balance less every fee share from NU7 to the block it was read at", async () => {
    expect(await carried({})).toBe(CARRIED);
  });

  it("is null when the index is a block behind the node, never short by that block", async () => {
    expect(
      await carried({}, tip({ height: NU7_HEIGHT + 206, hash: `h${NU7_HEIGHT + 206}` })),
    ).toBeNull();
  });

  it("is null when the index holds another branch at that height", async () => {
    expect(await carried({ hashes: new Map([[NU7_HEIGHT + 205, "other"]]) })).toBeNull();
  });

  it("is null when one fee since NU7 is unknown, or one block is missing", async () => {
    const unknown = new Map(CHAIN).set(NU7_HEIGHT + 3, null);
    expect(await carried({ fees: unknown })).toBeNull();
    const late = new Map(CHAIN).set(NU7_HEIGHT + 200, null);
    expect(await carried({ fees: late })).toBeNull();
    const gap = new Map(CHAIN);
    gap.delete(NU7_HEIGHT + 150);
    expect(await carried({ fees: gap })).toBeNull();
  });

  it("is null without a balance, before NU7, from reissuance, or below zero", async () => {
    expect(await carried({}, tip({ nsmZat: null }))).toBeNull();
    expect(await carried({}, tip({ height: NU7_HEIGHT - 1 }))).toBeNull();
    expect(await carried({}, tip({ height: REISSUANCE_START_HEIGHT }))).toBeNull();
    expect(await carried({}, tip({ nsmZat: 5 }))).toBeNull();
  });
});

describe("GET /chain/miners/nsm", () => {
  const nsmAtTip =
    (over: Partial<{ height: number; hash: string; nsmZat: number | null }> = {}) =>
    async () => ({
      height: NU7_HEIGHT + 205,
      hash: `h${NU7_HEIGHT + 205}`,
      nsmZat: CARRIED + 206 * 6,
      ...over,
    });
  const get = async (deps: Parameters<typeof minersRoutes>[0]) => {
    const res = await minersRoutes({ now: () => NOW * 1000, ...deps }).request("/chain/miners/nsm");
    expect(res.status).toBe(200);
    return (await res.json()) as NsmOverview;
  };
  const pool = () => fakePool({ activation: ACTIVATION_TS });

  it("pairs the index's days with the node's balance and what it carried in", async () => {
    const body = await get({ pool: pool(), nsmAtTip: nsmAtTip() });
    expect(body.balance).toEqual({
      height: NU7_HEIGHT + 205,
      zat: CARRIED + 1_236,
      carriedInZat: CARRIED,
    });
    expect(body.days).toHaveLength(3);
  });

  it("states an unreported balance after NU7 as unknown, never zero", async () => {
    const body = await get({ pool: pool(), nsmAtTip: nsmAtTip({ nsmZat: null }) });
    expect(body.balance).toEqual({ height: NU7_HEIGHT + 205, zat: null, carriedInZat: null });
  });

  it("answers the days when the node does not, with no balance", async () => {
    const logged: string[] = [];
    const body = await get({
      pool: pool(),
      nsmAtTip: async () => {
        throw new Error("node timeout");
      },
      log: (m) => logged.push(m),
    });
    expect(body.balance).toBeNull();
    expect(body.days).toHaveLength(3);
    expect(logged.join()).toMatch(/node timeout/);
  });
});
