import {
  EXCHANGES,
  exchangeFlowInterval,
  exchangeFlowWindowStart,
  type ExchangeFlowPart,
  type ExchangeFlowPeriod,
  type ExchangeFlowPeriodFigures,
  type ExchangeFlowSide,
  type ExchangeFlowTotal,
  type ExchangeFlowWindow,
  type ExchangeId,
  type ExchangeMovement,
  type FlowKind,
} from "@/domain";
import { utcDayFromSeconds } from "@/domain/time";
import { apiRequest, type ApiRequestConfig } from "./api-request";

/**
 * `/v1/labels/exchanges/flows` and `/movements`, read for `/exchanges`. The public shapes are
 * mapped onto domain types here and nowhere else; anything unrecognised is version skew and
 * fails loudly rather than rendering a blank cell.
 */

const FLOW_KINDS: readonly FlowKind[] = [
  "transparent",
  "shielded",
  "mined",
  "exchange",
  "bridge",
  "other-labelled",
  "fee",
  "mixed",
];

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function zatOf(v: unknown, what: string): number {
  if (!isRecord(v) || typeof v.zat !== "number" || !Number.isSafeInteger(v.zat)) {
    throw new Error(`exchange flows: ${what} is not an amount`);
  }
  return v.zat;
}

function intOf(v: unknown, what: string): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v)) {
    throw new Error(`exchange flows: ${what} is not a count`);
  }
  return v;
}

function dayOf(v: unknown, what: string): number {
  const t = typeof v === "string" ? Date.parse(`${v}T00:00:00Z`) : NaN;
  if (!Number.isFinite(t)) throw new Error(`exchange flows: ${what} is not a day`);
  return t / 1000;
}

function partOf(v: unknown): ExchangeFlowPart {
  if (!isRecord(v) || !FLOW_KINDS.includes(v.kind as FlowKind)) {
    throw new Error("exchange flows: a part has no known kind");
  }
  const exchange = v.exchange ?? null;
  if (exchange !== null && typeof exchange !== "string") {
    throw new Error("exchange flows: a part's exchange is not a name");
  }
  return {
    kind: v.kind as FlowKind,
    // An exchange this build does not know yet (the API ships first): still an exchange, unnamed.
    exchange: (EXCHANGES as readonly unknown[]).includes(exchange)
      ? (exchange as ExchangeId)
      : null,
    zat: zatOf(v.value, "a part"),
  };
}

function sideOf(v: unknown, what: string): ExchangeFlowSide {
  if (!isRecord(v) || !Array.isArray(v.parts)) throw new Error(`exchange flows: ${what}`);
  return { txs: intOf(v.txs, what), zat: zatOf(v.value, what), parts: v.parts.map(partOf) };
}

function totalOf(v: unknown, e: string): ExchangeFlowTotal | null {
  if (v === null) return null;
  if (!isRecord(v) || !isRecord(v.internal)) throw new Error(`exchange flows: ${e} totals`);
  return {
    in: sideOf(v.in, `${e} in`),
    out: sideOf(v.out, `${e} out`),
    internalTxs: intOf(v.internal.txs, `${e} internal`),
    internalFeeZat: zatOf(v.internal.fee, `${e} internal fee`),
  };
}

function figuresOf(v: unknown, e: string): ExchangeFlowPeriodFigures | null {
  if (v === null) return null;
  if (!isRecord(v)) throw new Error(`exchange flows: ${e} point`);
  return {
    inZat: zatOf(v.in, `${e} point in`),
    outZat: zatOf(v.out, `${e} point out`),
    inTxs: intOf(v.inTxs, `${e} point inTxs`),
    outTxs: intOf(v.outTxs, `${e} point outTxs`),
  };
}

function allOf(v: unknown, i: number): ExchangeFlowPeriod["all"] {
  if (v === null || v === undefined) return null;
  if (!isRecord(v) || !isRecord(v.in) || !isRecord(v.out)) {
    throw new Error(`exchange flows: point ${i} allExchanges`);
  }
  return {
    inZat: zatOf(v.in.value, `point ${i} all in`),
    outZat: zatOf(v.out.value, `point ${i} all out`),
    betweenZat: zatOf(v.betweenExchanges, `point ${i} between`),
  };
}

/** Every exchange this build knows, keyed: a missing one is a newer or older API. */
function perExchange<T>(v: unknown, read: (x: unknown, e: string) => T): Record<ExchangeId, T> {
  if (!isRecord(v)) throw new Error("exchange flows: no exchanges");
  const out = {} as Record<ExchangeId, T>;
  for (const e of EXCHANGES) {
    if (!(e in v)) throw new Error(`exchange flows: ${e} is missing`);
    out[e] = read(v[e], e);
  }
  return out;
}

/**
 * The query the page asks for a window: its first day, an end of tomorrow (the end is exclusive,
 * so today is inside it; a day series needs both edges) and its grain. All of history sends none.
 */
export function flowsQuery(windowDays: number | null, nowSec: number) {
  const start = exchangeFlowWindowStart(windowDays, nowSec);
  const tomorrow = (Math.floor(nowSec / 86_400) + 1) * 86_400;
  return {
    from: start === null ? null : utcDayFromSeconds(start),
    to: start === null ? null : utcDayFromSeconds(tomorrow),
    interval: exchangeFlowInterval(windowDays),
  };
}

export function parseExchangeFlows(
  body: unknown,
  asked: { from: string | null; to: string | null; interval: "day" | "month" },
  windowDays: number | null,
): ExchangeFlowWindow {
  if (!isRecord(body) || !isRecord(body.query) || !isRecord(body.data)) {
    throw new Error("exchange flows: unrecognised shape");
  }
  // The echo: an API that ignored `from` answers all of history under a window's label.
  if (
    (body.query.from ?? null) !== asked.from ||
    (body.query.to ?? null) !== asked.to ||
    body.query.interval !== asked.interval
  ) {
    throw new Error("exchange flows: the API answered a different window");
  }
  if (body.query.exchange !== null) throw new Error("exchange flows: narrowed to one exchange");
  const data = body.data;
  if (!isRecord(data.totals) || !Array.isArray(data.points)) {
    throw new Error("exchange flows: unrecognised data");
  }
  const counted = isRecord(data.counted)
    ? { from: dayOf(data.counted.from, "counted.from"), to: dayOf(data.counted.to, "counted.to") }
    : null;
  const notes =
    isRecord(body.coverage) && Array.isArray(body.coverage.notes)
      ? body.coverage.notes.filter((n): n is string => typeof n === "string")
      : [];
  return {
    windowDays,
    interval: asked.interval,
    counted,
    totals: perExchange(data.totals.exchanges, totalOf),
    points: data.points.map((p, i) => {
      if (!isRecord(p)) throw new Error(`exchange flows: point ${i}`);
      return {
        timestamp: dayOf(p.periodStart, `point ${i}`),
        from: p.from === undefined ? null : dayOf(p.from, `point ${i} from`),
        through: p.through === undefined ? null : dayOf(p.through, `point ${i} through`),
        exchanges: perExchange(p.exchanges, figuresOf),
        all: allOf(p.allExchanges, i),
      };
    }),
    notes,
  };
}

export function parseExchangeMovements(
  body: unknown,
  asked: { from: string | null; to: string | null; exchange: ExchangeId | null },
): ExchangeMovement[] {
  const known = (e: unknown): e is ExchangeId => (EXCHANGES as readonly unknown[]).includes(e);
  if (!isRecord(body) || !isRecord(body.query) || !Array.isArray(body.items)) {
    throw new Error("exchange movements: unrecognised shape");
  }
  if (
    (body.query.from ?? null) !== asked.from ||
    (body.query.to ?? null) !== asked.to ||
    (body.query.exchange ?? null) !== asked.exchange
  ) {
    throw new Error("exchange movements: the API answered a different window or exchange");
  }
  // A movement of an exchange this build does not know yet is left out, never the page.
  const items = body.items.filter((v) => !isRecord(v) || known(v.exchange));
  return items.map((v, i) => {
    if (
      !isRecord(v) ||
      typeof v.txid !== "string" ||
      (v.direction !== "in" && v.direction !== "out") ||
      !Array.isArray(v.parts)
    ) {
      throw new Error(`exchange movements: item ${i}`);
    }
    return {
      txid: v.txid,
      exchange: v.exchange as ExchangeId,
      direction: v.direction,
      zat: zatOf(v.value, `item ${i}`),
      timestamp: intOf(v.timestamp, `item ${i} timestamp`),
      parts: v.parts.map(partOf),
    };
  });
}

/** How many movements the page lists. */
export const MOVEMENTS_SHOWN = 10;

/**
 * One minute per warm instance and per query: the route is `force-no-store`, so without it every
 * view would read the keyless /v1 surface twice. A failure is never stored.
 */
const MEMO_MS = 60_000;
const memo = new Map<string, { at: number; value: Promise<unknown> }>();

/** Test seam: the memo is module state. */
export function resetExchangeFlowsMemo(): void {
  memo.clear();
}

function remembered<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < MEMO_MS) return hit.value as Promise<T>;
  const value = load();
  memo.set(key, { at: Date.now(), value });
  value.catch(() => {
    if (memo.get(key)?.value === value) memo.delete(key);
  });
  return value;
}

async function read(config: ApiRequestConfig, path: string, what: string): Promise<unknown> {
  const res = await apiRequest(config, path, 60);
  // ` for ` keeps a 5xx classified as transient, so the page says "unavailable" and stays up.
  if (!res.ok) throw new Error(`chain API returned ${res.status} for ${what}`);
  return res.json();
}

export function createExchangeFlowsSource(config: ApiRequestConfig) {
  return {
    getExchangeFlows(windowDays: number | null): Promise<ExchangeFlowWindow> {
      const asked = flowsQuery(windowDays, Math.floor(Date.now() / 1000));
      const q = new URLSearchParams();
      if (asked.from !== null) q.set("from", asked.from);
      if (asked.to !== null) q.set("to", asked.to);
      q.set("interval", asked.interval);
      return remembered(`flows:${q}`, async () =>
        parseExchangeFlows(
          await read(config, `/v1/labels/exchanges/flows?${q}`, "exchange flows"),
          asked,
          windowDays,
        ),
      );
    },

    getExchangeMovements(
      windowDays: number | null,
      exchange: ExchangeId | null,
      through: number,
    ): Promise<ExchangeMovement[]> {
      const { from } = flowsQuery(windowDays, Math.floor(Date.now() / 1000));
      // Ends with the last day the totals count, so the list never holds a day they do not.
      const to = utcDayFromSeconds(through + 86_400);
      const q = new URLSearchParams();
      if (from !== null) q.set("from", from);
      q.set("to", to);
      if (exchange !== null) q.set("exchange", exchange);
      q.set("limit", String(MOVEMENTS_SHOWN));
      return remembered(`movements:${q}`, async () =>
        parseExchangeMovements(
          await read(config, `/v1/labels/exchanges/movements?${q}`, "exchange movements"),
          { from, to, exchange },
        ),
      );
    },
  };
}
