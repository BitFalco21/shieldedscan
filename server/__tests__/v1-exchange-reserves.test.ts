import { describe, expect, it } from "vitest";
import type { Pool } from "pg";
import type { ExchangeMember } from "@/domain";
import { V1_EXCHANGE_RESERVES_PATH, v1ExchangeReservesRoutes } from "../v1/exchange-reserves";

/**
 * `/v1/labels/exchanges` at the HTTP boundary: strict parameters, the window echoed, a month read
 * at its closing day, the change taken from the close before the window, and an exchange stated
 * only when all of its addresses are computed.
 */
const DAY = 86_400;
const D = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 1000;
const MEMBERS: ExchangeMember[] = [
  { address: "tA", exchange: "binance" },
  { address: "tB", exchange: "binance" },
  { address: "tK", exchange: "kraken" },
];

/** Daily rows 2026-09-28 .. 2026-10-03; tB first used 2026-10-01; tK computed through 10-02. */
function load() {
  const rows = [];
  for (let t = D("2026-09-28"); t <= D("2026-10-03"); t += DAY) {
    const i = (t - D("2026-09-28")) / DAY;
    rows.push({ address: "tA", day: t, balanceZat: 1_000 + i * 10, closeHeight: 100 + i });
    if (t >= D("2026-10-01")) {
      rows.push({ address: "tB", day: t, balanceZat: 500, closeHeight: 100 + i });
    }
    if (t <= D("2026-10-02")) {
      rows.push({ address: "tK", day: t, balanceZat: 7, closeHeight: 100 + i });
    }
  }
  rows.sort((a, b) => a.day - b.day);
  return {
    rows,
    computedThrough: new Map<string, number | null>([
      ["tA", D("2026-10-03")],
      ["tB", D("2026-10-03")],
      ["tK", D("2026-10-02")],
    ]),
    beyondLiveTail: [] as string[],
    tipHeight: 105,
  };
}

const app = v1ExchangeReservesRoutes({
  pool: {} as Pool,
  members: MEMBERS,
  now: () => (D("2026-10-03") + 3_600) * 1000,
  load: async () => load(),
});
type Amount = { zat: number; zec: string } | null;
interface Point {
  closing: { day: string; height: number };
  exchanges: Record<string, Amount>;
  total: Amount;
}
interface Body {
  query: unknown;
  exchanges: unknown;
  data: {
    points: Point[];
    change: { from: unknown; exchanges: Record<string, Amount> };
  };
  addresses?: unknown;
  unknowns: Record<string, string>;
  coverage: { status: string };
  basis: string;
}
const get = async (query: string) => {
  const res = await app.request(`${V1_EXCHANGE_RESERVES_PATH}${query}`);
  return { status: res.status, body: (await res.json()) as Body };
};

describe("/v1/labels/exchanges", () => {
  it("reads a month at its closing day and measures the change from the close before the window", async () => {
    const { status, body } = await get("?from=2026-10-01");
    expect(status).toBe(200);
    expect(body.query).toEqual({
      from: "2026-10-01",
      to: null,
      interval: "month",
      exchange: null,
      addresses: false,
    });
    expect(body.exchanges).toEqual([
      { id: "binance", name: "Binance", addresses: 2 },
      { id: "coinbase", name: "Coinbase", addresses: 0 },
      { id: "gemini", name: "Gemini", addresses: 0 },
      { id: "kraken", name: "Kraken", addresses: 1 },
    ]);
    const oct = body.data.points[0]!;
    expect(oct.closing).toEqual({ day: "2026-10-03", height: 105 });
    expect(oct.exchanges.binance!.zat).toBe(1_050 + 500);
    // tK is not computed through 10-03: Kraken and the total are unmeasured, never 0.
    expect(oct.exchanges.kraken).toBeNull();
    expect(oct.total).toBeNull();
    expect(body.unknowns["data.points.0.exchanges.kraken"]).toBe("unmeasured");
    // From 09-30's close (1,020, tB not yet used) to 10-03's (1,550).
    expect(body.data.change.from).toEqual({ day: "2026-09-30", height: 102 });
    expect(body.data.change.exchanges.binance!.zat).toBe(530);
    expect(body.coverage.status).toBe("partial");
    expect(body.basis).toMatch(/unlabelled exchange wallets are not counted/);
  });

  it("narrows to one exchange and lists its addresses on request", async () => {
    const { body } = await get(
      "?interval=day&from=2026-10-01&to=2026-10-03&exchange=binance&addresses=true",
    );
    expect(body.data.points.map((p) => p.exchanges.binance!.zat)).toEqual([1_530, 1_540]);
    expect(Object.keys(body.data.points[0]!.exchanges)).toEqual(["binance"]);
    expect(body.addresses).toEqual([
      {
        address: "tA",
        exchange: "binance",
        balance: { zat: 1_040, zec: "0.00001040" },
        change: { zat: 20, zec: "0.00000020" },
      },
      {
        address: "tB",
        exchange: "binance",
        balance: { zat: 500, zec: "0.00000500" },
        change: { zat: 500, zec: "0.00000500" },
      },
    ]);
  });

  it("names this read's own live limit when an address is stored too far back, never 'not computed'", async () => {
    // tK stored through 10-01 only: two days short of today's point.
    const notesFor = async (beyondLiveTail: string[]) => {
      const routes = v1ExchangeReservesRoutes({
        pool: {} as Pool,
        members: MEMBERS,
        now: () => (D("2026-10-03") + 3_600) * 1000,
        load: async () => {
          const base = load();
          base.computedThrough.set("tK", D("2026-10-01"));
          return { ...base, beyondLiveTail };
        },
      });
      const res = await routes.request(`${V1_EXCHANGE_RESERVES_PATH}?from=2026-10-01`);
      return ((await res.json()) as { coverage: { notes: string[] } }).coverage.notes.join(" ");
    };
    const capped = await notesFor(["tK"]);
    expect(capped).toMatch(
      /1 labelled address\(es\) are stored more than 3 days behind the newest block, and this answer computes at most 3 days live/,
    );
    expect(capped).not.toMatch(/not computed through/);
    // Without the cap, the same address is one the walk has not reached.
    expect(await notesFor([])).toMatch(
      /1 labelled address\(es\) are not computed through the window yet/,
    );
  });

  it("rejects what it does not understand rather than widening the answer", async () => {
    expect((await get("?exchange=bitget")).status).toBe(400);
    expect((await get("?addresses=yes")).status).toBe(400);
    expect((await get("?pool=orchard")).status).toBe(400);
    expect((await get("?interval=day")).status).toBe(400);
  });
});
