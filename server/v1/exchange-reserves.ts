import { Hono } from "hono";
import type { Pool } from "pg";
import {
  EXCHANGES,
  EXCHANGE_MEMBERS,
  EXCHANGE_NAMES,
  exchangeAddressCounts,
  exchangeReserveDays,
  exchangeReserveTotal,
  type AddressDayBalance,
  type ExchangeId,
  type ExchangeMember,
  type ExchangeReserveDay,
} from "@/domain";
import { DAY_SECONDS, utcDayFromSeconds } from "@/domain/time";
import { MAINNET_SITE_URL as SITE } from "@/lib/network";
import { Cached } from "../cached";
import {
  RESERVE_LIVE_TAIL_MAX_DAYS,
  loadReserveRows,
  type ReserveRows,
} from "../exchange-reserves";
import { parseSeriesWindow } from "./analytics-series";
import { amount } from "./format";
import { routeGroupErrors, setCache } from "./http";
import { ParamError, rejectUnknown } from "./params";

/**
 * `/v1/labels/exchanges`: the transparent ZEC on each exchange's labelled addresses, per day or
 * month, read at each period's highest block. Pure builder below, so the arithmetic (a level never
 * summed, an exchange stated only when every address of it is computed) is tested without a
 * database.
 */

export const V1_EXCHANGE_RESERVES_PATH = "/v1/labels/exchanges";

export const EXCHANGE_RESERVES_BASIS =
  "transparent ZEC on each exchange's labelled addresses at the period's highest block; a level, never summed across points. Grouping the addresses by exchange is this explorer's; unlabelled exchange wallets are not counted.";

type Amount = ReturnType<typeof amount>;

export interface ExchangeReservesWindow {
  from: string | null;
  to: string | null;
  interval: "day" | "month";
  fromTs: number;
  toTs: number;
}

export interface ExchangeReservesQuery {
  exchange: ExchangeId | null;
  addresses: boolean;
}

function monthOf(ts: number): number {
  const d = new Date(ts * 1000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000;
}

/** An address's balance at the end of `day`: its newest row at or before it, 0 before first use. */
function addressAt(
  rows: readonly AddressDayBalance[],
  through: number | null,
  day: number,
): number | null {
  if (through === null || through < day) return null;
  let balance = 0;
  for (const r of rows) {
    if (r.day > day) break;
    balance = r.balanceZat;
  }
  return balance;
}

export function buildExchangeReserves(
  input: {
    days: readonly ExchangeReserveDay[];
    rows: readonly AddressDayBalance[];
    computedThrough: ReadonlyMap<string, number | null>;
    /** Addresses whose stored days were too far behind for the read to compute any live. */
    beyondLiveTail?: readonly string[];
    members: readonly ExchangeMember[];
  },
  w: ExchangeReservesWindow,
  q: ExchangeReservesQuery,
  nowSec: number,
) {
  const shown = q.exchange === null ? EXCHANGES : [q.exchange];
  const unknowns: Record<string, string> = {};
  const kept = input.days.filter((d) => d.timestamp >= w.fromTs && d.timestamp < w.toTs);
  const byPeriod = new Map<number, ExchangeReserveDay>();
  for (const d of kept)
    byPeriod.set(w.interval === "month" ? monthOf(d.timestamp) : d.timestamp, d);

  const exchangesOf = (d: ExchangeReserveDay, key: string) => {
    const out: Record<string, Amount | null> = {};
    for (const e of shown) {
      const v = d.zat[e];
      out[e] = v === null ? null : amount(v);
      if (v === null) unknowns[`${key}.exchanges.${e}`] = "unmeasured";
    }
    const total = exchangeReserveTotal(d, shown);
    if (total === null) unknowns[`${key}.total`] = "unmeasured";
    return { exchanges: out, total: total === null ? null : amount(total) };
  };

  const points = [...byPeriod.entries()].map(([start, d], i) => ({
    periodStart: utcDayFromSeconds(start),
    closing: { day: utcDayFromSeconds(d.timestamp), height: d.closeHeight },
    ...exchangesOf(d, `data.points.${i}`),
  }));

  // The change across the window: its last close against the close of the day before it, or
  // against its own first day when nothing precedes it.
  const closing = kept.at(-1) ?? null;
  const before = input.days.filter((d) => d.timestamp < w.fromTs).at(-1) ?? null;
  const opening = before ?? kept[0] ?? null;
  const change =
    closing === null || opening === null
      ? null
      : (() => {
          const exchanges: Record<string, Amount | null> = {};
          for (const e of shown) {
            const a = opening.zat[e];
            const b = closing.zat[e];
            exchanges[e] = a === null || b === null ? null : amount(b - a);
            if (exchanges[e] === null) unknowns[`data.change.exchanges.${e}`] = "unmeasured";
          }
          const a = exchangeReserveTotal(opening, shown);
          const b = exchangeReserveTotal(closing, shown);
          return {
            from: { day: utcDayFromSeconds(opening.timestamp), height: opening.closeHeight },
            to: { day: utcDayFromSeconds(closing.timestamp), height: closing.closeHeight },
            exchanges,
            total: a === null || b === null ? null : amount(b - a),
          };
        })();
  if (change === null) unknowns["data.change"] = "nonexistent";

  const counts = exchangeAddressCounts(input.members);
  const exchanges = shown.map((e) => ({ id: e, name: EXCHANGE_NAMES[e], addresses: counts[e] }));

  // Per address: its balance at the window's last close and its change across the window. The
  // full per-address series is the open dataset's `address_balance_daily`.
  let addresses: unknown[] | undefined;
  if (q.addresses) {
    const rowsOf = new Map<string, AddressDayBalance[]>();
    for (const r of [...input.rows].sort((a, b) => a.day - b.day)) {
      const list = rowsOf.get(r.address);
      if (list) list.push(r);
      else rowsOf.set(r.address, [r]);
    }
    addresses = input.members
      .filter((m) => shown.includes(m.exchange))
      .map((m, i) => {
        const through = input.computedThrough.get(m.address) ?? null;
        const own = rowsOf.get(m.address) ?? [];
        const b = closing === null ? null : addressAt(own, through, closing.timestamp);
        const a = opening === null ? null : addressAt(own, through, opening.timestamp);
        if (b === null) unknowns[`addresses.${i}.balance`] = "unmeasured";
        if (a === null || b === null) unknowns[`addresses.${i}.change`] = "unmeasured";
        return {
          address: m.address,
          exchange: m.exchange,
          balance: b === null ? null : amount(b),
          change: a === null || b === null ? null : amount(b - a),
        };
      });
  }

  const notes: string[] = [];
  const todayStart = Math.floor(nowSec / DAY_SECONDS) * DAY_SECONDS;
  if (w.toTs > todayStart && closing !== null && closing.timestamp >= todayStart) {
    notes.push("The last point is today's unfinished UTC day, read at the newest block.");
  }
  const behind = input.members.filter((m) => {
    const t = input.computedThrough.get(m.address) ?? null;
    return (
      shown.includes(m.exchange) && (t === null || t < Math.min(w.toTs, todayStart) - DAY_SECONDS)
    );
  });
  // Two reasons an address falls short, and the note names the right one: the walk has not reached
  // it, or it is stored further back than this answer computes live (a limit of ours).
  const capped = new Set(input.beyondLiveTail ?? []);
  const beyond = behind.filter((m) => capped.has(m.address));
  const notYet = behind.length - beyond.length;
  if (beyond.length > 0) {
    notes.push(
      `${beyond.length} labelled address(es) are stored more than ${RESERVE_LIVE_TAIL_MAX_DAYS} days behind the newest block, and this answer computes at most ${RESERVE_LIVE_TAIL_MAX_DAYS} days live; their exchange reads null where so.`,
    );
  }
  if (notYet > 0) {
    notes.push(
      `${notYet} labelled address(es) are not computed through the window yet; their exchange reads null where so.`,
    );
  }

  return {
    coverage: { status: notes.length === 0 ? ("complete" as const) : ("partial" as const), notes },
    exchanges,
    data: { interval: w.interval, points, change },
    ...(addresses === undefined ? {} : { addresses }),
    unknowns,
  };
}

export function parseExchangeReservesQuery(q: Record<string, string>): ExchangeReservesQuery {
  const raw = q.exchange;
  if (raw !== undefined && !(EXCHANGES as readonly string[]).includes(raw)) {
    throw new ParamError("invalid_parameter", `exchange must be one of ${EXCHANGES.join(", ")}`);
  }
  const a = q.addresses;
  if (a !== undefined && a !== "true" && a !== "false") {
    throw new ParamError("invalid_parameter", "addresses must be true or false");
  }
  return { exchange: (raw as ExchangeId | undefined) ?? null, addresses: a === "true" };
}

// ------------------------------------------------------------------------------- route

/** Five minutes: the newest day moves with every block, the stored days not at all. */
const MEMO_MS = 5 * 60 * 1000;
const STALE_MS = 30 * 60 * 1000;

export interface V1ExchangeReservesDeps {
  pool: Pool;
  members?: readonly ExchangeMember[];
  now?: () => number;
  /** Injectable so the HTTP contract is testable without a database. */
  load?: () => Promise<ReserveRows>;
}

export function v1ExchangeReservesRoutes(deps: V1ExchangeReservesDeps): Hono {
  const app = new Hono();
  const now = deps.now ?? Date.now;
  const nowSec = () => Math.floor(now() / 1000);
  const members = deps.members ?? EXCHANGE_MEMBERS;
  const load =
    deps.load ??
    (() =>
      loadReserveRows(
        deps.pool,
        members.map((m) => m.address),
      ));
  const memo = new Cached<ReserveRows>(MEMO_MS, { staleMs: STALE_MS });

  app.onError(routeGroupErrors("the chain index could not answer just now; retry shortly"));

  app.get(V1_EXCHANGE_RESERVES_PATH, async (c) => {
    const q = c.req.query();
    rejectUnknown(q, ["from", "to", "interval", "exchange", "addresses"]);
    const w = parseSeriesWindow(q);
    const query = parseExchangeReservesQuery(q);
    const loaded = await memo.get(load);
    const days = exchangeReserveDays(loaded.rows, members, loaded.computedThrough);
    const built = buildExchangeReserves(
      {
        days,
        rows: loaded.rows,
        computedThrough: loaded.computedThrough,
        beyondLiveTail: loaded.beyondLiveTail,
        members,
      },
      w,
      query,
      nowSec(),
    );
    setCache(c, "series");
    return c.json({
      query: {
        from: w.from,
        to: w.to,
        interval: w.interval,
        exchange: query.exchange,
        addresses: query.addresses,
      },
      coverage: built.coverage,
      source: { name: "ShieldedScan", url: `${SITE}/charts/exchange-reserves` },
      basis: EXCHANGE_RESERVES_BASIS,
      exchanges: built.exchanges,
      data: built.data,
      ...("addresses" in built ? { addresses: built.addresses } : {}),
      unknowns: built.unknowns,
      asOf: nowSec(),
    });
  });

  return app;
}
