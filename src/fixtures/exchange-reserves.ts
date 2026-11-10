import {
  EXCHANGE_MEMBERS,
  exchangeReserveDays,
  type AddressDayBalance,
  type ExchangeReserveDay,
} from "@/domain";
import { TIP_HEIGHT, TIP_TIME } from "./ids";

/**
 * Sample daily balances for the labelled exchange addresses, deterministic, shaped to carry the
 * cases the chart and the API must handle: an address first used part-way through (it held
 * nothing before, so its exchange is not a gap), and one address whose newest days are not
 * computed yet (its exchange reads null there).
 */

const DAY = 86_400;

export interface ReserveFixture {
  rows: AddressDayBalance[];
  computedThrough: Map<string, number | null>;
}

/** A small deterministic walk, so the lines move without a random source. */
function walk(seed: number, i: number): number {
  return Math.sin(seed * 12.9898 + i * 0.071) * 0.5 + Math.sin(seed + i * 0.013) * 0.5;
}

export function reserveFixture(lastDay: number, days: number, tipHeight: number): ReserveFixture {
  const first = lastDay - (days - 1) * DAY;
  const rows: AddressDayBalance[] = [];
  const computedThrough = new Map<string, number | null>();
  EXCHANGE_MEMBERS.forEach((m, k) => {
    // Kraken addresses at odd positions are first used a third of the way in.
    const start = m.exchange === "kraken" && k % 2 === 1 ? Math.floor(days / 3) : 0;
    // One Coinbase address is three days behind.
    const lag =
      m.exchange === "coinbase" &&
      k === EXCHANGE_MEMBERS.findIndex((x) => x.exchange === "coinbase")
        ? 3
        : 0;
    const base = (k % 7) * 4_000 + 2_000;
    for (let i = start; i < days - lag; i += 1) {
      const zec = Math.max(0, base * (1 + 0.35 * walk(k + 1, i)));
      rows.push({
        address: m.address,
        day: first + i * DAY,
        balanceZat: Math.round(zec) * 100_000_000,
        closeHeight: tipHeight - (days - 1 - i) * 1_152,
      });
    }
    computedThrough.set(m.address, lastDay - lag * DAY);
  });
  rows.sort((a, b) => a.day - b.day || (a.address < b.address ? -1 : 1));
  return { rows, computedThrough };
}

/** The site's sample: 420 days ending on the fixture chain's tip day. */
export function getExchangeReserves(): ExchangeReserveDay[] {
  const f = reserveFixture(Math.floor(TIP_TIME / DAY) * DAY, 420, TIP_HEIGHT);
  return exchangeReserveDays(f.rows, EXCHANGE_MEMBERS, f.computedThrough);
}
