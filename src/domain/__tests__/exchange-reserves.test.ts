import { describe, expect, it } from "vitest";
import { ADDRESS_LABELS, type AddressLabel } from "../address-label";
import {
  EXCHANGE_MEMBERS,
  LABEL_EXCHANGE,
  closingBalances,
  exchangeAddressCounts,
  exchangeMembers,
  exchangeReserveDays,
  exchangeReserveSummary,
  exchangeReserveTotal,
  type ExchangeMember,
} from "../exchange-reserves";

const DAY = 86_400;

describe("which labelled addresses count as an exchange's", () => {
  it("decides every label name, so a new label is never counted or dropped silently", () => {
    const names = new Set(Object.values(ADDRESS_LABELS).map((l) => l.name));
    for (const name of names) expect(LABEL_EXCHANGE, name).toHaveProperty([name]);
    // And no decision about a name that no longer exists.
    for (const name of Object.keys(LABEL_EXCHANGE)) expect(names.has(name), name).toBe(true);
  });

  it("merges each exchange's wallets and counts nothing else", () => {
    expect(exchangeAddressCounts()).toEqual({ binance: 5, coinbase: 21, gemini: 6, kraken: 3 });
    const names = EXCHANGE_MEMBERS.map((m) => ADDRESS_LABELS[m.address]!.name);
    expect(names).not.toContain("Grayscale Zcash Trust");
    expect(names).not.toContain("NEAR Intents Bridge Hot Wallet");
    expect(names).not.toContain("Hyperunit Hot Wallet");
    expect(names).not.toContain("ZIP-271 Disbursement Multisig");
    expect(EXCHANGE_MEMBERS.map((m) => m.address)).toEqual(
      [...EXCHANGE_MEMBERS.map((m) => m.address)].sort(),
    );
  });

  it("never counts a theft-flagged address, whatever its name", () => {
    const labels: Record<string, AddressLabel> = {
      t1flagged: {
        name: "Binance Hot Wallet",
        basis: "external",
        source: "test",
        flag: { by: "someone", href: "https://example.com" },
      },
      t1plain: { name: "Binance Hot Wallet", basis: "external", source: "test" },
      t1unknown: { name: "A New Exchange", basis: "external", source: "test" },
    };
    expect(exchangeMembers(labels)).toEqual([{ address: "t1plain", exchange: "binance" }]);
  });
});

describe("closingBalances", () => {
  const closes = [
    { day: 10 * DAY, close: 100 },
    { day: 11 * DAY, close: 200 },
    { day: 12 * DAY, close: 300 },
  ];

  it("reads each day at its highest block, carrying a quiet day forward", () => {
    const rows = closingBalances(
      "tA",
      { fromHeight: 50, balanceZat: 1_000, seen: true },
      [
        [60, 500],
        [150, -200],
        [100, 7],
      ],
      closes,
    );
    expect(rows.map((r) => r.balanceZat)).toEqual([1_507, 1_307, 1_307]);
    expect(rows.map((r) => r.closeHeight)).toEqual([100, 200, 300]);
  });

  it("writes no row before an address's first use, then every day after it, an emptied one too", () => {
    const rows = closingBalances(
      "tA",
      { fromHeight: 50, balanceZat: 0, seen: false },
      [
        [150, 40],
        [250, -40],
      ],
      closes,
    );
    expect(rows.map((r) => [r.day / DAY, r.balanceZat])).toEqual([
      [11, 40],
      [12, 0],
    ]);
  });

  it("ignores blocks at or below the starting height, which the starting balance already holds", () => {
    const rows = closingBalances(
      "tA",
      { fromHeight: 150, balanceZat: 100, seen: true },
      [
        [120, 999],
        [150, 999],
        [160, 1],
      ],
      [{ day: 12 * DAY, close: 300 }],
    );
    expect(rows.map((r) => r.balanceZat)).toEqual([101]);
  });

  it("takes every block at or below a close when miners stamped the days out of order", () => {
    // Day 11's highest block sits below a block stamped on day 10.
    const rows = closingBalances(
      "tA",
      { fromHeight: 0, balanceZat: 0, seen: true },
      [
        [105, 5],
        [95, 1],
      ],
      [
        { day: 10 * DAY, close: 110 },
        { day: 11 * DAY, close: 100 },
      ],
    );
    expect(rows.map((r) => r.balanceZat)).toEqual([6, 1]);
  });
});

describe("exchangeReserveDays", () => {
  const members: ExchangeMember[] = [
    { address: "tA", exchange: "binance" },
    { address: "tB", exchange: "binance" },
    { address: "tC", exchange: "kraken" },
  ];
  const row = (address: string, day: number, balanceZat: number) => ({
    address,
    day: day * DAY,
    balanceZat,
    closeHeight: day * 100,
  });

  it("sums an exchange's addresses, an address not yet used holding nothing", () => {
    const days = exchangeReserveDays(
      [row("tA", 1, 10), row("tA", 2, 12), row("tB", 2, 5), row("tC", 1, 3), row("tC", 2, 3)],
      members,
      new Map([
        ["tA", 2 * DAY],
        ["tB", 2 * DAY],
        ["tC", 2 * DAY],
      ]),
    );
    expect(days).toEqual([
      {
        timestamp: DAY,
        closeHeight: 100,
        zat: { binance: 10, coinbase: 0, gemini: 0, kraken: 3 },
      },
      {
        timestamp: 2 * DAY,
        closeHeight: 200,
        zat: { binance: 17, coinbase: 0, gemini: 0, kraken: 3 },
      },
    ]);
  });

  it("states no total for an exchange with an address not computed through the day", () => {
    const days = exchangeReserveDays(
      [row("tA", 1, 10), row("tA", 2, 12), row("tC", 2, 3)],
      members,
      new Map<string, number | null>([
        ["tA", 2 * DAY],
        ["tB", DAY],
        ["tC", null],
      ]),
    );
    expect(days.map((d) => d.zat.binance)).toEqual([10, null]);
    expect(days.map((d) => d.zat.kraken)).toEqual([null, null]);
  });
});

describe("exchangeReserveSummary", () => {
  const day = (n: number, binance: number | null, kraken: number) => ({
    timestamp: n * DAY,
    closeHeight: n * 100,
    zat: { binance, coinbase: 0, gemini: 0, kraken },
  });

  it("states the newest day and the change from thirty days before it", () => {
    const s = exchangeReserveSummary(
      [day(1, 50, 9), day(2, 80, 9), day(31, 70, 4), day(32, null, 3)],
      [
        { address: "tA", exchange: "binance" },
        { address: "tK", exchange: "kraken" },
      ],
    )!;
    expect(s.timestamp).toBe(32 * DAY);
    expect(s.rows.find((r) => r.exchange === "kraken")).toEqual({
      exchange: "kraken",
      addresses: 1,
      zat: 3,
      changeZat: -6,
    });
    // Binance is not stated on the newest day: neither its balance nor its change.
    expect(s.rows.find((r) => r.exchange === "binance")).toMatchObject({
      zat: null,
      changeZat: null,
    });
  });

  it("states no change where the series does not reach back that far", () => {
    const s = exchangeReserveSummary([day(31, 70, 4)], [{ address: "tK", exchange: "kraken" }])!;
    expect(s.rows.find((r) => r.exchange === "kraken")!.changeZat).toBeNull();
    expect(exchangeReserveSummary([])).toBeNull();
  });
});

describe("exchangeReserveTotal", () => {
  const day = { zat: { binance: 1, coinbase: 2, gemini: 3, kraken: null } };

  it("sums the exchanges asked for", () => {
    expect(exchangeReserveTotal(day, ["binance", "coinbase", "gemini"])).toBe(6);
  });

  it("is null when any exchange in the sum is not computed through the day", () => {
    expect(exchangeReserveTotal(day)).toBeNull();
    expect(exchangeReserveTotal({ zat: { ...day.zat, kraken: 4 } })).toBe(10);
  });
});
