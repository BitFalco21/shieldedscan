import { EXCHANGES } from "@/domain";
import type { LabelFlowAggregates, LabelFlowRow } from "../../label-flows";

/**
 * Thirty days of exchange flows ending yesterday, for the agent's fixture world: every exchange
 * with inflows from transparent addresses and a shielded pool, outflows to transparent addresses,
 * another exchange and the fee, and moves between its own wallets.
 */
export function flowFixture(nowSec: number): {
  aggregates: LabelFlowAggregates;
  largest: { caps: Map<string, number | null>; rows: LabelFlowRow[] };
} {
  const today = Math.floor(nowSec / 86_400);
  const tip = 3_429_000;
  const caps = new Map<string, number | null>([
    ...EXCHANGES.map((e) => [e, tip - 100] as [string, number]),
    ["bridge", tip - 100],
    ["other", tip - 100],
  ]);
  const aggregates: LabelFlowAggregates = {
    caps,
    days: [],
    parts: [],
    unresolved: new Map(),
    dayLastHeight: new Map(),
  };
  for (let k = 30; k >= 1; k -= 1) {
    const day = today - k;
    aggregates.dayLastHeight.set(day, tip - 200 - k * 1_000);
    EXCHANGES.forEach((exchange, i) => {
      const inZat = (i + 1) * 1_000_000_000_000 + k * 10_000_000;
      const outZat = (i + 1) * 800_000_000_000 + k * 7_000_000;
      const toNext = 100_000_000_000;
      aggregates.days.push(
        { day, exchange, direction: "in", txs: 40 + i, zat: inZat },
        { day, exchange, direction: "out", txs: 12 + i, zat: outZat },
        { day, exchange, direction: "internal", txs: 3, zat: 30_000 },
      );
      const next = EXCHANGES[(i + 1) % EXCHANGES.length]!;
      const prev = EXCHANGES[(i + EXCHANGES.length - 1) % EXCHANGES.length]!;
      aggregates.parts.push(
        {
          day,
          exchange,
          direction: "in",
          kind: "transparent",
          counterpart: null,
          zat: inZat - 2 * toNext,
        },
        { day, exchange, direction: "in", kind: "shielded", counterpart: null, zat: toNext },
        { day, exchange, direction: "in", kind: "exchange", counterpart: prev, zat: toNext },
        {
          day,
          exchange,
          direction: "out",
          kind: "transparent",
          counterpart: null,
          zat: outZat - toNext - 20_000,
        },
        { day, exchange, direction: "out", kind: "exchange", counterpart: next, zat: toNext },
        { day, exchange, direction: "out", kind: "fee", counterpart: null, zat: 20_000 },
      );
    });
  }
  const rows: LabelFlowRow[] = [
    {
      txid: "f".repeat(64),
      exchange: "binance",
      direction: "out",
      zat: 2_500_000_000_000,
      height: tip - 5_000,
      timestamp: (today - 3) * 86_400 + 3_600,
      parts: [
        { kind: "transparent", zat: 2_499_999_980_000 },
        { kind: "fee", zat: 20_000 },
      ],
    },
  ];
  return { aggregates, largest: { caps, rows } };
}
