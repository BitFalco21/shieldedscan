import { Hono } from "hono";
import type { Pool } from "pg";
import { ADDRESS_LABELS, EXCHANGES, EXCHANGE_NAMES, type ExchangeId } from "@/domain";
import { utcDayFromSeconds } from "@/domain/time";
import { MAINNET_SITE_URL as SITE } from "@/lib/network";
import { Cached } from "../cached";
import {
  countedCaps,
  loadLabelFlowAggregates,
  loadLargestLabelFlows,
  type LabelFlowAggregates,
  type LabelFlowRow,
} from "../label-flows";
import { parseSeriesWindow, type SeriesWindow } from "./analytics-series";
import { amount } from "./format";
import { errorBody, routeGroupErrors, setCache } from "./http";
import { createKeyedCache } from "./keyed-cache";
import { ParamError, rejectUnknown } from "./params";

/**
 * `/v1/labels/exchanges/flows` and `/movements`: ZEC moving into and out of each exchange's
 * labelled addresses, from the flows the primary's tracker classifies as it stores each
 * transaction. The builder is pure, so the arithmetic is tested without a database.
 */

export const V1_EXCHANGE_FLOWS_PATH = "/v1/labels/exchanges/flows";
export const V1_EXCHANGE_MOVEMENTS_PATH = "/v1/labels/exchanges/movements";

export const EXCHANGE_FLOWS_BASIS =
  "ZEC paid to each exchange's labelled transparent addresses minus ZEC spent from them, per transaction, so change returned to the exchange cancels out. Its shielded wallets and unlabelled deposit addresses are not seen: a deposit to an unlabelled address shows when it is swept into a labelled wallet. `parts` say where value came from or went where the chain states it exactly; `mixed` is value whose split it does not state, so every other kind is a floor. `txs` counts transactions, not customers. A move between two exchanges counts for both; `allExchanges` leaves it out.";

const DAY = 86_400;

/** The order parts are listed in, and the kinds a part may have. */
const PART_ORDER = [
  "transparent",
  "shielded",
  "mined",
  "exchange",
  "bridge",
  "other-labelled",
  "fee",
  "mixed",
] as const;

type Amount = ReturnType<typeof amount>;

/** A sum as an amount; past 2^53 zatoshi a JS number would round it, so that fails loudly. */
function safeAmount(zat: number): Amount {
  if (!Number.isSafeInteger(zat)) throw new Error("a flow sum passed 2^53 zatoshi");
  return amount(zat);
}
type Part = { kind: string; exchange?: string; value: Amount };

interface Side {
  txs: number;
  zat: number;
  parts: Map<string, number>;
}

interface ExchangeSums {
  in: Side;
  out: Side;
  internal: { txs: number; zat: number };
}

const newSide = (): Side => ({ txs: 0, zat: 0, parts: new Map() });
const newSums = (): ExchangeSums => ({
  in: newSide(),
  out: newSide(),
  internal: { txs: 0, zat: 0 },
});

const partKey = (kind: string, counterpart: string | null) =>
  counterpart === null ? kind : `${kind}:${counterpart}`;

function partsOut(parts: Map<string, number>, skipExchanges = false): Part[] {
  const out: Part[] = [];
  for (const [key, zat] of parts) {
    const [kind, counterpart] = key.split(":") as [string, string | undefined];
    if (skipExchanges && kind === "exchange") continue;
    out.push({
      kind,
      ...(counterpart === undefined ? {} : { exchange: counterpart }),
      value: safeAmount(zat),
    });
  }
  const rank = (k: string) => (PART_ORDER as readonly string[]).indexOf(k);
  return out.sort(
    (a, b) => rank(a.kind) - rank(b.kind) || (a.exchange ?? "").localeCompare(b.exchange ?? ""),
  );
}

function sideOut(s: Side, withParts: boolean) {
  return {
    txs: s.txs,
    value: safeAmount(s.zat),
    ...(withParts ? { parts: partsOut(s.parts) } : {}),
  };
}

function exchangeOut(e: ExchangeSums) {
  return {
    in: sideOut(e.in, true),
    out: sideOut(e.out, true),
    internal: { txs: e.internal.txs, fee: safeAmount(e.internal.zat) },
  };
}

/** One period's figures for one exchange: what a series needs, a few dozen bytes. */
function exchangePointOut(e: ExchangeSums) {
  return {
    in: safeAmount(e.in.zat),
    out: safeAmount(e.out.zat),
    inTxs: e.in.txs,
    outTxs: e.out.txs,
  };
}

/** Value into and out of the exchanges as a whole: a move between two of them left out. */
function allOut(sums: readonly ExchangeSums[], withParts: boolean) {
  const side = (pick: (e: ExchangeSums) => Side) => {
    const parts = new Map<string, number>();
    let zat = 0;
    let between = 0;
    for (const e of sums) {
      const s = pick(e);
      zat += s.zat;
      for (const [k, v] of s.parts) {
        if (k.startsWith("exchange:")) between += v;
        else parts.set(k, (parts.get(k) ?? 0) + v);
      }
    }
    return { zat: zat - between, parts, between };
  };
  const inn = side((e) => e.in);
  const out = side((e) => e.out);
  return {
    in: { value: safeAmount(inn.zat), ...(withParts ? { parts: partsOut(inn.parts) } : {}) },
    out: { value: safeAmount(out.zat), ...(withParts ? { parts: partsOut(out.parts) } : {}) },
    // As sent: the receiving side of the same move is less the fee where the senders paid it.
    betweenExchanges: safeAmount(out.between),
  };
}

function monthStart(day: number): number {
  const d = new Date(day * DAY * 1000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000 / DAY;
}

/** The aggregates with their rows filed by day, once per load, so a request reads its days only. */
export interface IndexedFlows {
  agg: LabelFlowAggregates;
  byDay: Map<number, { days: LabelFlowAggregates["days"]; parts: LabelFlowAggregates["parts"] }>;
  firstDay: number;
}

export function indexFlows(agg: LabelFlowAggregates): IndexedFlows {
  const byDay: IndexedFlows["byDay"] = new Map();
  const at = (day: number) => {
    let e = byDay.get(day);
    if (e === undefined) byDay.set(day, (e = { days: [], parts: [] }));
    return e;
  };
  let firstDay = Infinity;
  for (const r of agg.days) {
    at(r.day).days.push(r);
    firstDay = Math.min(firstDay, r.day);
  }
  for (const r of agg.parts) at(r.day).parts.push(r);
  return { agg, byDay, firstDay };
}

export interface ExchangeFlowsQuery {
  exchange: ExchangeId | null;
}

export function buildExchangeFlows(indexed: IndexedFlows, w: SeriesWindow, q: ExchangeFlowsQuery) {
  const agg = indexed.agg;
  const unknowns: Record<string, string> = {};
  const notes: string[] = [];
  const shown: readonly ExchangeId[] = q.exchange === null ? EXCHANGES : [q.exchange];
  const counted = countedCaps(agg.caps);
  const measured = shown.filter((e) => counted.has(e));
  const unmeasured = shown.filter((e) => !counted.has(e));
  if (unmeasured.length > 0) {
    notes.push(
      `Not counted yet: ${unmeasured.map((e) => EXCHANGE_NAMES[e]).join(", ")}. Labelled addresses of theirs are still being walked or reclassified.`,
    );
  }
  // Any other group not counted (a bridge, another exchange) leaves value it moved looking like
  // transparent addresses in the parts of the exchanges shown.
  const others = [...agg.caps.keys()].filter((g) => !shown.includes(g as ExchangeId));
  if (others.some((g) => !counted.has(g))) {
    notes.push(
      "Some other labelled addresses are still being walked: value they moved may show as transparent in `parts`.",
    );
  }

  // Count whole days only, each once every block in it is classified and below the reorg depth.
  const h = measured.length === 0 ? -1 : Math.min(...measured.map((e) => counted.get(e)!));
  let through = -1;
  for (const [day, last] of agg.dayLastHeight) if (last <= h && day > through) through = day;
  const firstDay = Math.max(Math.floor(w.fromTs / DAY), indexed.firstDay);
  const lastDay = Math.min(through, Math.ceil(w.toTs / DAY) - 1);
  const windowLast = Number.isFinite(w.toTs) ? Math.ceil(w.toTs / DAY) - 1 : Infinity;
  if (lastDay < windowLast && measured.length > 0) {
    notes.push(
      through < 0
        ? "No day is counted yet."
        : `Counted through ${utcDayFromSeconds(through * DAY)}: a day counts once every block in it is at least 100 blocks deep.`,
    );
  }
  const inWindow = (day: number) => day >= firstDay && day <= lastDay;
  const periodOf = (day: number) => (w.interval === "month" ? monthStart(day) : day);

  // period → exchange → sums
  const periods = new Map<number, Map<string, ExchangeSums>>();
  const total = new Map<string, ExchangeSums>();
  const sumsOf = (m: Map<string, ExchangeSums>, e: string) => {
    let s = m.get(e);
    if (s === undefined) m.set(e, (s = newSums()));
    return s;
  };
  for (let d = firstDay; d <= lastDay && Number.isFinite(firstDay); d += 1) {
    const p = periodOf(d);
    if (!periods.has(p)) periods.set(p, new Map());
  }
  const dayRows = [];
  const partRows = [];
  for (let d = firstDay; d <= lastDay && Number.isFinite(firstDay); d += 1) {
    const e = indexed.byDay.get(d);
    if (e !== undefined) {
      dayRows.push(...e.days);
      partRows.push(...e.parts);
    }
  }
  for (const r of dayRows) {
    if (!measured.includes(r.exchange as ExchangeId)) continue;
    for (const m of [
      sumsOf(periods.get(periodOf(r.day))!, r.exchange),
      sumsOf(total, r.exchange),
    ]) {
      if (r.direction === "internal") {
        m.internal.txs += r.txs;
        m.internal.zat += r.zat;
      } else {
        m[r.direction].txs += r.txs;
        m[r.direction].zat += r.zat;
      }
    }
  }
  for (const r of partRows) {
    if (!measured.includes(r.exchange as ExchangeId)) continue;
    const k = partKey(r.kind, r.counterpart);
    for (const m of [
      sumsOf(periods.get(periodOf(r.day))!, r.exchange),
      sumsOf(total, r.exchange),
    ]) {
      const side = m[r.direction];
      side.parts.set(k, (side.parts.get(k) ?? 0) + r.zat);
    }
  }
  let unresolved = 0;
  for (const [day, n] of agg.unresolved) if (inWindow(day)) unresolved += n;
  if (unresolved > 0) {
    notes.push(
      `${unresolved} transaction(s) in this window have an input this index could not resolve; their flows may be wrong.`,
    );
  }

  // Parts on the window's totals only: per period they would multiply the answer many times over.
  const block = <T>(
    m: Map<string, ExchangeSums>,
    key: string,
    withParts: boolean,
    out: (e: ExchangeSums) => T,
  ) => {
    const exchanges: Record<string, T | null> = {};
    for (const e of shown) {
      if (measured.includes(e)) exchanges[e] = out(m.get(e) ?? newSums());
      else {
        exchanges[e] = null;
        unknowns[`${key}.exchanges.${e}`] = "unmeasured";
      }
    }
    if (q.exchange !== null) return { exchanges };
    const all =
      unmeasured.length === 0
        ? allOut(
            shown.map((e) => m.get(e) ?? newSums()),
            withParts,
          )
        : null;
    if (all === null) unknowns[`${key}.allExchanges`] = "unmeasured";
    return { exchanges, allExchanges: all };
  };

  const points = [...periods.keys()]
    .sort((a, b) => a - b)
    .map((p, i) => {
      const end = w.interval === "month" ? monthStart(p + 32) - 1 : p;
      return {
        periodStart: utcDayFromSeconds(p * DAY),
        // A period the window cuts: the days it counts.
        ...(p < firstDay ? { from: utcDayFromSeconds(firstDay * DAY) } : {}),
        ...(end > lastDay ? { through: utcDayFromSeconds(lastDay * DAY) } : {}),
        ...block(periods.get(p)!, `data.points.${i}`, false, exchangePointOut),
      };
    });

  return {
    coverage: { status: notes.length === 0 ? ("complete" as const) : ("partial" as const), notes },
    exchanges: shown.map((e) => ({ id: e, name: EXCHANGE_NAMES[e] })),
    data: {
      interval: w.interval,
      counted:
        lastDay >= firstDay && Number.isFinite(firstDay)
          ? { from: utcDayFromSeconds(firstDay * DAY), to: utcDayFromSeconds(lastDay * DAY) }
          : null,
      totals: block(total, "data.totals", true, exchangeOut),
      points,
    },
    unknowns,
  };
}

export function parseExchangeFlowsQuery(q: Record<string, string>): ExchangeFlowsQuery {
  const raw = q.exchange;
  if (raw !== undefined && !(EXCHANGES as readonly string[]).includes(raw)) {
    throw new ParamError("invalid_parameter", `exchange must be one of ${EXCHANGES.join(", ")}`);
  }
  return { exchange: (raw as ExchangeId | undefined) ?? null };
}

export function parseMovementsQuery(q: Record<string, string>) {
  const { exchange } = parseExchangeFlowsQuery(q);
  const d = q.direction;
  if (d !== undefined && d !== "in" && d !== "out") {
    throw new ParamError("invalid_parameter", "direction must be in or out");
  }
  const raw = q.limit ?? "10";
  const limit = Number(raw);
  if (!/^\d+$/.test(raw) || limit < 1 || limit > MOVEMENTS_MAX) {
    throw new ParamError("invalid_parameter", `limit must be 1 to ${MOVEMENTS_MAX}`);
  }
  return { exchange, direction: (d as "in" | "out" | undefined) ?? null, limit };
}

/** A ranking, bounded rather than paged: a paged ranking would be an offset walk. */
export const MOVEMENTS_MAX = 25;

export function movementOut(r: LabelFlowRow) {
  return {
    txid: r.txid,
    exchange: r.exchange,
    direction: r.direction,
    value: amount(r.zat),
    height: r.height,
    timestamp: r.timestamp,
    day: utcDayFromSeconds(r.timestamp),
    parts: r.parts.map((p) => ({
      kind: p.kind,
      ...(p.exchange === undefined ? {} : { exchange: p.exchange }),
      value: amount(p.zat),
    })),
  };
}

// ------------------------------------------------------------------------------- routes

/** The whole history's daily sums are one query: memoised and sliced per request. */
const MEMO_MS = 10 * 60 * 1000;
const STALE_MS = 30 * 60 * 1000;

export class FlowsUnavailableError extends Error {}

export interface V1ExchangeFlowsDeps {
  pool: Pool;
  /**
   * The movements ranking queries per request (cached briefly), so it runs on a pool of its own,
   * never holding a connection the memo-backed series wait on. Defaults to `pool`.
   */
  movementsPool?: Pool;
  now?: () => number;
  /** Injectable so the HTTP contract is testable without a database. */
  load?: () => Promise<LabelFlowAggregates | null>;
  largest?: typeof loadLargestLabelFlows;
}

export function v1ExchangeFlowsRoutes(deps: V1ExchangeFlowsDeps): Hono {
  const app = new Hono();
  const now = deps.now ?? Date.now;
  const nowSec = () => Math.floor(now() / 1000);
  const addresses = Object.keys(ADDRESS_LABELS);
  const load = deps.load ?? (() => loadLabelFlowAggregates(deps.pool, addresses, nowSec()));
  const largest = deps.largest ?? loadLargestLabelFlows;
  const memo = new Cached<IndexedFlows>(MEMO_MS, { staleMs: STALE_MS });
  /** Each answer for a minute: building one walks its window's days, and the same is asked often. */
  const answers = createKeyedCache({ now, max: 200 });
  const unavailable = "the exchange flows are being recomputed; retry shortly";

  app.onError((err, c) => {
    if (!(err instanceof FlowsUnavailableError)) {
      return routeGroupErrors("the chain index could not answer just now; retry shortly")(err, c);
    }
    c.header("Retry-After", "60");
    return c.json(errorBody(c, "upstream_unavailable", unavailable, nowSec()), 503);
  });

  const source = { name: "ShieldedScan", url: `${SITE}/rich-list` };

  app.get(V1_EXCHANGE_FLOWS_PATH, async (c) => {
    const q = c.req.query();
    rejectUnknown(q, ["from", "to", "interval", "exchange"]);
    const w = parseSeriesWindow(q);
    const query = parseExchangeFlowsQuery(q);
    const echo = { from: w.from, to: w.to, interval: w.interval, exchange: query.exchange };
    const body = await answers(JSON.stringify(echo), 60_000, async () => {
      // A null load is never memoised: it throws, so the next request asks again.
      const indexed = await memo.get(async () => {
        const a = await load();
        if (a === null) throw new FlowsUnavailableError();
        return indexFlows(a);
      });
      const built = buildExchangeFlows(indexed, w, query);
      return {
        query: echo,
        coverage: built.coverage,
        source,
        basis: EXCHANGE_FLOWS_BASIS,
        exchanges: built.exchanges,
        data: built.data,
        unknowns: built.unknowns,
        asOf: nowSec(),
      };
    });
    setCache(c, "series");
    return c.json(body);
  });

  app.get(V1_EXCHANGE_MOVEMENTS_PATH, async (c) => {
    const q = c.req.query();
    rejectUnknown(q, ["from", "to", "exchange", "direction", "limit"]);
    const w = parseSeriesWindow({
      ...(q.from ? { from: q.from } : {}),
      ...(q.to ? { to: q.to } : {}),
    });
    const m = parseMovementsQuery(q);
    const echo = {
      from: w.from,
      to: w.to,
      exchange: m.exchange,
      direction: m.direction,
      limit: m.limit,
    };
    const body = await answers(`movements:${JSON.stringify(echo)}`, 60_000, async () => {
      const got = await largest(deps.movementsPool ?? deps.pool, addresses, {
        ...m,
        fromTs: w.fromTs,
        toTs: w.toTs,
      });
      if (got === null) throw new FlowsUnavailableError();
      const counted = countedCaps(got.caps);
      const shown: readonly string[] = m.exchange === null ? EXCHANGES : [m.exchange];
      const missing = shown.filter((e) => !counted.has(e));
      const notes =
        missing.length === 0
          ? []
          : [
              `Not counted yet: ${missing.map((e) => EXCHANGE_NAMES[e as ExchangeId]).join(", ")}. Labelled addresses of theirs are still being walked or reclassified.`,
            ];
      return {
        query: echo,
        coverage: { status: notes.length === 0 ? "complete" : "partial", notes },
        source,
        basis: EXCHANGE_FLOWS_BASIS,
        items: got.rows.map(movementOut),
        asOf: nowSec(),
      };
    });
    setCache(c, "aggregate");
    return c.json(body);
  });

  return app;
}
