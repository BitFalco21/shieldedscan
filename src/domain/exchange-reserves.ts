/**
 * Transparent ZEC held by exchanges, on the addresses this explorer labels.
 *
 * Grouping a label's addresses under one exchange is this explorer's decision, not a chain fact:
 * every surface that shows a total says so, and says how many addresses it sums. Unlabelled
 * exchange wallets are not counted, so a total is the labelled addresses only, never an
 * exchange's holdings.
 */

import { ADDRESS_LABELS, type AddressLabel } from "./address-label";

export const EXCHANGES = ["binance", "coinbase", "gemini", "kraken"] as const;
export type ExchangeId = (typeof EXCHANGES)[number];

export const EXCHANGE_NAMES: Readonly<Record<ExchangeId, string>> = {
  binance: "Binance",
  coinbase: "Coinbase",
  gemini: "Gemini",
  kraken: "Kraken",
};

/** Why a label is not counted under any exchange. */
export interface ExcludedLabel {
  excluded: string;
}

/**
 * Every label name in `ADDRESS_LABELS`, decided by hand: the exchange or custodian it belongs to,
 * or why it is not one. A test fails on a name missing here, so a new label is never counted (or
 * dropped) without a decision. A theft-flagged address is never counted, whatever its name.
 */
export const LABEL_EXCHANGE: Readonly<Record<string, ExchangeId | ExcludedLabel>> = {
  Binance: "binance",
  "Binance Cold Wallet": "binance",
  "Binance Hot Wallet": "binance",
  Coinbase: "coinbase",
  "Coinbase Cold Wallet": "coinbase",
  "Coinbase Prime Custody": "coinbase",
  "Gemini Cold Wallet": "gemini",
  "Gemini Custody": "gemini",
  "Kraken Cold Wallet": "kraken",
  "Kraken Deposit": "kraken",
  "Kraken Hot Wallet": "kraken",
  "Grayscale Zcash Trust": { excluded: "an investment trust, not an exchange" },
  "NEAR Intents Bridge Hot Wallet": { excluded: "a bridge's hot wallet" },
  "Hyperunit Hot Wallet": { excluded: "a bridge's hot wallet" },
  "ZIP-271 Disbursement Multisig": { excluded: "the dev fund lockbox disbursement multisig" },
  "BitGet Exploit Sept 2026": { excluded: "flagged as part of a theft" },
  "DPRK attackers": { excluded: "flagged as part of a theft" },
};

export interface ExchangeMember {
  address: string;
  exchange: ExchangeId;
}

/** The addresses counted, by exchange, in address order. An unmapped name counts nowhere. */
export function exchangeMembers(
  labels: Readonly<Record<string, AddressLabel>> = ADDRESS_LABELS,
): ExchangeMember[] {
  const members: ExchangeMember[] = [];
  for (const [address, label] of Object.entries(labels)) {
    if (label.flag) continue;
    const decided = LABEL_EXCHANGE[label.name];
    if (typeof decided === "string") members.push({ address, exchange: decided });
  }
  return members.sort((a, b) => (a.address < b.address ? -1 : a.address > b.address ? 1 : 0));
}

export const EXCHANGE_MEMBERS: readonly ExchangeMember[] = exchangeMembers();

/** How many labelled addresses each exchange's total sums. */
export function exchangeAddressCounts(
  members: readonly ExchangeMember[] = EXCHANGE_MEMBERS,
): Record<ExchangeId, number> {
  const counts = Object.fromEntries(EXCHANGES.map((e) => [e, 0])) as Record<ExchangeId, number>;
  for (const m of members) counts[m.exchange] += 1;
  return counts;
}

// ------------------------------------------------------------------------- daily balances

/** One UTC day's highest block. */
export interface ReserveDayClose {
  /** Unix seconds of the day's UTC midnight. */
  day: number;
  /** The highest block stamped that day. */
  close: number;
}

/** An address's balance at a day's highest block. */
export interface AddressDayBalance {
  address: string;
  day: number;
  balanceZat: number;
  closeHeight: number;
}

/**
 * An address's balance at each close, from a known starting balance at `fromHeight` and the net
 * change of every block above it (`[height, delta]`, outputs minus inputs). A close takes every
 * block at or below it, whatever order the miners' timestamps put the days in.
 *
 * `seen` says whether the address had been used by `fromHeight`. Before its first use an address
 * has no row: it did not hold nothing, it did not exist yet as far as the chain shows.
 */
export function closingBalances(
  address: string,
  start: { fromHeight: number; balanceZat: number; seen: boolean },
  deltas: readonly (readonly [number, number])[],
  closes: readonly ReserveDayClose[],
): AddressDayBalance[] {
  const sorted = deltas.filter(([h]) => h > start.fromHeight).sort((a, b) => a[0] - b[0]);
  const prefix: number[] = [];
  let running = 0;
  for (const [, d] of sorted) prefix.push((running += d));
  /** The net change of the blocks above `fromHeight` and at or below `h`, and whether any. */
  const through = (h: number): { sum: number; any: boolean } => {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid]![0] <= h) lo = mid + 1;
      else hi = mid;
    }
    return { sum: lo === 0 ? 0 : prefix[lo - 1]!, any: lo > 0 };
  };
  const rows: AddressDayBalance[] = [];
  for (const c of closes) {
    const t = through(c.close);
    if (!start.seen && !t.any) continue;
    rows.push({ address, day: c.day, balanceZat: start.balanceZat + t.sum, closeHeight: c.close });
  }
  return rows;
}

/** One day of the exchanges' labelled balances. */
export interface ExchangeReserveDay {
  /** Unix seconds of the day's UTC midnight. */
  timestamp: number;
  /** The day's highest block, which every balance is read at. */
  closeHeight: number;
  /** Null for an exchange whose addresses are not all computed through the day: not none. */
  zat: Record<ExchangeId, number | null>;
}

/**
 * The day's sum over `exchanges` (all four by default), or null when any of them is not computed
 * through the day: a sum missing an exchange is not a total. The one definition the API, the
 * chart's readout and every other surface use.
 */
export function exchangeReserveTotal(
  day: Pick<ExchangeReserveDay, "zat">,
  exchanges: readonly ExchangeId[] = EXCHANGES,
): number | null {
  let sum = 0;
  for (const e of exchanges) {
    const v = day.zat[e];
    if (v === null) return null;
    sum += v;
  }
  return sum;
}

/**
 * The exchanges' totals per day, from per-address rows. An exchange is stated for a day only when
 * every one of its addresses is computed through it (`computedThrough`, a day, or null when not
 * started); an address with no row yet that day was not used yet and holds 0.
 */
export function exchangeReserveDays(
  rows: readonly AddressDayBalance[],
  members: readonly ExchangeMember[],
  computedThrough: ReadonlyMap<string, number | null>,
): ExchangeReserveDay[] {
  const byDay = new Map<number, AddressDayBalance[]>();
  for (const r of rows) {
    const list = byDay.get(r.day);
    if (list) list.push(r);
    else byDay.set(r.day, [r]);
  }
  const last = new Map<string, number>();
  const out: ExchangeReserveDay[] = [];
  for (const day of [...byDay.keys()].sort((a, b) => a - b)) {
    const today = byDay.get(day)!;
    for (const r of today) last.set(r.address, r.balanceZat);
    const zat = Object.fromEntries(EXCHANGES.map((e) => [e, 0])) as Record<
      ExchangeId,
      number | null
    >;
    for (const m of members) {
      const through = computedThrough.get(m.address) ?? null;
      if (through === null || through < day) {
        zat[m.exchange] = null;
        continue;
      }
      const prev = zat[m.exchange];
      if (prev !== null) zat[m.exchange] = prev + (last.get(m.address) ?? 0);
    }
    out.push({ timestamp: day, closeHeight: Math.max(...today.map((r) => r.closeHeight)), zat });
  }
  return out;
}

/** The newest day of the series, and each exchange's change over the days before it. */
export interface ExchangeReserveSummary {
  timestamp: number;
  closeHeight: number;
  /** How many days the change spans. */
  changeDays: number;
  rows: {
    exchange: ExchangeId;
    addresses: number;
    zat: number | null;
    /** Null where either end is not stated, or the series does not reach back that far. */
    changeZat: number | null;
  }[];
}

/**
 * The newest day and each exchange's change from `changeDays` earlier. A level read at two days,
 * so the change is exact, and net.
 */
export function exchangeReserveSummary(
  days: readonly ExchangeReserveDay[],
  members: readonly ExchangeMember[] = EXCHANGE_MEMBERS,
  changeDays = 30,
): ExchangeReserveSummary | null {
  const last = days.at(-1);
  if (!last) return null;
  const then = days.find((d) => d.timestamp === last.timestamp - changeDays * 86_400) ?? null;
  const counts = exchangeAddressCounts(members);
  return {
    timestamp: last.timestamp,
    closeHeight: last.closeHeight,
    changeDays,
    rows: EXCHANGES.map((exchange) => {
      const now = last.zat[exchange];
      const before = then?.zat[exchange] ?? null;
      return {
        exchange,
        addresses: counts[exchange],
        zat: now,
        changeZat: now === null || before === null ? null : now - before,
      };
    }),
  };
}
