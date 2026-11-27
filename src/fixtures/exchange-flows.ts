import {
  EXCHANGES,
  exchangeFlowInterval,
  exchangeFlowWindowStart,
  type ExchangeFlowPart,
  type ExchangeFlowPeriodFigures,
  type ExchangeFlowTotal,
  type ExchangeFlowWindow,
  type ExchangeId,
  type ExchangeMovement,
} from "@/domain";
import { TIP_TIME } from "./ids";

/**
 * Two years of exchange flows, deterministic, carrying every case the page draws: inflows from
 * transparent addresses, a shielded pool and a bridge; outflows the same way plus the fee; a mixed
 * day; moves between two exchanges (booked on both, as the chain shows them); and moves between an
 * exchange's own wallets. The last day counted is the day before the fixture tip's.
 */

const DAY = 86_400;
const ZEC = 100_000_000;
const DAYS = 730;

interface DayFlows {
  day: number;
  in: Map<ExchangeId, { txs: number; parts: ExchangeFlowPart[] }>;
  out: Map<ExchangeId, { txs: number; parts: ExchangeFlowPart[] }>;
  internal: Map<ExchangeId, { txs: number; feeZat: number }>;
}

const wave = (seed: number, i: number) => 1 + 0.4 * Math.sin(seed * 1.7 + i * 0.09);

function buildDays(): DayFlows[] {
  const today = Math.floor(TIP_TIME / DAY) * DAY;
  const out: DayFlows[] = [];
  for (let k = DAYS; k >= 1; k -= 1) {
    const day = today - k * DAY;
    const i = DAYS - k;
    const flows: DayFlows = { day, in: new Map(), out: new Map(), internal: new Map() };
    EXCHANGES.forEach((e, n) => {
      const scale = (8 - n) * 400 * ZEC;
      const inParts: ExchangeFlowPart[] = [
        { kind: "transparent", exchange: null, zat: Math.round(scale * wave(n, i)) },
      ];
      const outParts: ExchangeFlowPart[] = [
        { kind: "transparent", exchange: null, zat: Math.round(scale * 0.9 * wave(n + 3, i)) },
        { kind: "fee", exchange: null, zat: 2_000 * (n + 1) },
      ];
      // Gemini takes shielded deposits; every exchange sees one now and then.
      if (e === "gemini" || i % 9 === n) {
        inParts.push({ kind: "shielded", exchange: null, zat: Math.round(scale * 0.2) });
      }
      if (i % 11 === n) outParts.push({ kind: "bridge", exchange: null, zat: 150 * ZEC });
      if (i % 13 === n) inParts.push({ kind: "bridge", exchange: null, zat: 90 * ZEC });
      // A day whose senders and receivers both included others: the split is unknowable.
      if (i % 17 === n) inParts.push({ kind: "mixed", exchange: null, zat: 300 * ZEC });
      flows.in.set(e, { txs: 30 + ((i + n) % 20), parts: inParts });
      flows.out.set(e, { txs: 10 + ((i * 3 + n) % 15), parts: outParts });
      flows.internal.set(e, { txs: 1 + ((i + n) % 3), feeZat: 1_500 });
    });
    // Each exchange sends the next one some ZEC every few days.
    EXCHANGES.forEach((from, n) => {
      if ((i + n) % 3 !== 0) return;
      const to = EXCHANGES[(n + 1) % EXCHANGES.length]!;
      const zat = 120 * ZEC + n * ZEC;
      flows.out.get(from)!.parts.push({ kind: "exchange", exchange: to, zat });
      flows.in.get(to)!.parts.push({ kind: "exchange", exchange: from, zat });
    });
    out.push(flows);
  }
  return out;
}

const DAYS_FLOWS = buildDays();

const sum = (parts: readonly ExchangeFlowPart[]) => parts.reduce((s, p) => s + p.zat, 0);

function addParts(into: ExchangeFlowPart[], parts: readonly ExchangeFlowPart[]) {
  for (const p of parts) {
    const held = into.find((q) => q.kind === p.kind && q.exchange === p.exchange);
    if (held) held.zat += p.zat;
    else into.push({ ...p });
  }
}

function monthStart(day: number): number {
  const d = new Date(day * 1000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000;
}

export function getExchangeFlows(windowDays: number | null): ExchangeFlowWindow {
  const start = exchangeFlowWindowStart(windowDays, TIP_TIME);
  const interval = exchangeFlowInterval(windowDays);
  const days = DAYS_FLOWS.filter((d) => start === null || d.day >= start);
  const totals = {} as Record<ExchangeId, ExchangeFlowTotal>;
  for (const e of EXCHANGES) {
    totals[e] = {
      in: { txs: 0, zat: 0, parts: [] },
      out: { txs: 0, zat: 0, parts: [] },
      internalTxs: 0,
      internalFeeZat: 0,
    };
  }
  const periods = new Map<number, Record<ExchangeId, ExchangeFlowPeriodFigures>>();
  const betweenByPeriod = new Map<number, { sent: number; taken: number }>();
  for (const d of days) {
    const key = interval === "month" ? monthStart(d.day) : d.day;
    const between = betweenByPeriod.get(key) ?? { sent: 0, taken: 0 };
    for (const e of EXCHANGES) {
      for (const p of d.out.get(e)!.parts) if (p.kind === "exchange") between.sent += p.zat;
      for (const p of d.in.get(e)!.parts) if (p.kind === "exchange") between.taken += p.zat;
    }
    betweenByPeriod.set(key, between);
    let figures = periods.get(key);
    if (!figures) {
      figures = Object.fromEntries(
        EXCHANGES.map((e) => [e, { inZat: 0, outZat: 0, inTxs: 0, outTxs: 0 }]),
      ) as Record<ExchangeId, ExchangeFlowPeriodFigures>;
      periods.set(key, figures);
    }
    for (const e of EXCHANGES) {
      const i = d.in.get(e)!;
      const o = d.out.get(e)!;
      const t = totals[e];
      t.in.txs += i.txs;
      t.in.zat += sum(i.parts);
      addParts(t.in.parts, i.parts);
      t.out.txs += o.txs;
      t.out.zat += sum(o.parts);
      addParts(t.out.parts, o.parts);
      t.internalTxs += d.internal.get(e)!.txs;
      t.internalFeeZat += d.internal.get(e)!.feeZat;
      const f = figures[e];
      f.inZat += sum(i.parts);
      f.outZat += sum(o.parts);
      f.inTxs += i.txs;
      f.outTxs += o.txs;
    }
  }
  const last = days.at(-1)?.day ?? null;
  const first = days[0]?.day ?? null;
  return {
    windowDays,
    interval,
    counted: first === null || last === null ? null : { from: first, to: last },
    totals,
    points: [...periods.entries()].map(([timestamp, exchanges]) => {
      const between = betweenByPeriod.get(timestamp) ?? { sent: 0, taken: 0 };
      const sumOf = (k: "inZat" | "outZat") => EXCHANGES.reduce((s, e) => s + exchanges[e][k], 0);
      return {
        timestamp,
        through:
          interval === "month" && last !== null && monthStart(last) === timestamp ? last : null,
        exchanges,
        all: {
          inZat: sumOf("inZat") - between.taken,
          outZat: sumOf("outZat") - between.sent,
          betweenZat: between.sent,
        },
      };
    }),
    notes: [],
  };
}

const MOVEMENTS: ExchangeMovement[] = [
  {
    txid: "e1".repeat(32),
    exchange: "gemini",
    direction: "out",
    zat: 100_000 * ZEC,
    timestamp: TIP_TIME - 3 * DAY,
    parts: [{ kind: "transparent", exchange: null, zat: 100_000 * ZEC }],
  },
  {
    txid: "e2".repeat(32),
    exchange: "binance",
    direction: "in",
    zat: 42_500 * ZEC,
    timestamp: TIP_TIME - 5 * DAY,
    parts: [{ kind: "transparent", exchange: null, zat: 42_500 * ZEC }],
  },
  {
    txid: "e3".repeat(32),
    exchange: "binance",
    direction: "out",
    zat: 20_000 * ZEC + 12_000,
    timestamp: TIP_TIME - 9 * DAY,
    parts: [
      { kind: "exchange", exchange: "kraken", zat: 20_000 * ZEC },
      { kind: "fee", exchange: null, zat: 12_000 },
    ],
  },
  {
    txid: "e3".repeat(32),
    exchange: "kraken",
    direction: "in",
    zat: 20_000 * ZEC,
    timestamp: TIP_TIME - 9 * DAY,
    parts: [{ kind: "exchange", exchange: "binance", zat: 20_000 * ZEC }],
  },
  {
    txid: "e4".repeat(32),
    exchange: "coinbase",
    direction: "in",
    zat: 15_300 * ZEC,
    timestamp: TIP_TIME - 20 * DAY,
    parts: [{ kind: "mixed", exchange: null, zat: 15_300 * ZEC }],
  },
  {
    txid: "e5".repeat(32),
    exchange: "gemini",
    direction: "in",
    zat: 4_000 * ZEC,
    timestamp: TIP_TIME - 40 * DAY,
    parts: [{ kind: "shielded", exchange: null, zat: 4_000 * ZEC }],
  },
  {
    txid: "e6".repeat(32),
    exchange: "okx",
    direction: "out",
    zat: 2_000 * ZEC + 5_000,
    timestamp: TIP_TIME - 200 * DAY,
    parts: [
      { kind: "bridge", exchange: null, zat: 2_000 * ZEC },
      { kind: "fee", exchange: null, zat: 5_000 },
    ],
  },
];

export function getExchangeMovements(
  windowDays: number | null,
  exchange: ExchangeId | null,
): ExchangeMovement[] {
  const start = exchangeFlowWindowStart(windowDays, TIP_TIME);
  return MOVEMENTS.filter(
    (m) =>
      (start === null || m.timestamp >= start) && (exchange === null || m.exchange === exchange),
  ).sort((a, b) => b.zat - a.zat);
}
