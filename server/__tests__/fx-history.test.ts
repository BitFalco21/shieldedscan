import { describe, expect, it } from "vitest";
import range from "./fixtures/frankfurter-range.json";
import btcUsd from "./fixtures/yahoo-btc-usd.json";
import {
  assembleFxRates,
  deriveOfferedCurrencies,
  expandWithCarry,
  type FxRate,
  parseEcbRange,
  parseYahooBtc,
} from "../fx-history";

/**
 * `fixtures/frankfurter-range.json` is eleven days lifted verbatim from a live Frankfurter range
 * response over Zcash's launch week (so it includes a weekend), so an upstream field rename fails
 * here.
 *
 * It was requested with `symbols=EUR,GBP,ISK` and came back with EUR and GBP only: the ECB
 * published no krona in 2016, which is why ISK is excluded.
 */
describe("parseEcbRange", () => {
  it("keys on the ECB day and lowercases the currency", () => {
    const byDay = parseEcbRange(range);
    expect(byDay.get("2016-10-28")).toMatchObject({ eur: expect.any(Number) });
    expect(byDay.get("2016-10-28")!.eur).toBe(
      (range as { rates: Record<string, Record<string, number>> }).rates["2016-10-28"]!.EUR,
    );
  });

  it("emits no entry for a weekend the ECB never published", () => {
    const byDay = parseEcbRange(range);
    // 2016-10-29 is a Saturday. Carrying it is `expandWithCarry`'s job, not the parser's.
    expect(byDay.has("2016-10-29")).toBe(false);
  });

  it("rejects a non-finite or non-positive rate rather than storing it", () => {
    const byDay = parseEcbRange({ rates: { "2020-01-02": { EUR: 0, GBP: 0.75 } } });
    expect(byDay.get("2020-01-02")).toEqual({ gbp: 0.75 });
  });
});

describe("deriveOfferedCurrencies", () => {
  // The three real shapes over Zcash's history:
  //   eur — every ECB business day                                -> offered
  //   isk — starts 2018-02-01, when the ECB resumed quoting it    -> excluded
  //   hrk — ends 2022-12-30, Croatia adopted the euro             -> excluded
  // isk matters most: it is quoted today, so a list taken from the vendor's current output
  // would include it and fail silently on Zcash's first fifteen months.
  const byDay = new Map<string, Record<string, number>>([
    ["2016-10-28", { eur: 0.91, hrk: 6.86 }],
    ["2019-01-02", { eur: 0.87, hrk: 6.63, isk: 116.2 }],
    ["2026-08-27", { eur: 0.85, isk: 122.4 }],
  ]);

  it("offers only currencies present on every published day", () => {
    expect(deriveOfferedCurrencies(byDay)).toEqual(["eur"]);
  });

  it("excludes a currency that starts late and one that ends early", () => {
    const offered = deriveOfferedCurrencies(byDay);
    expect(offered).not.toContain("isk");
    expect(offered).not.toContain("hrk");
  });

  it("returns nothing rather than everything when there are no days", () => {
    // A fetch that failed must not read as a chain with no currencies.
    expect(deriveOfferedCurrencies(new Map())).toEqual([]);
  });
});

describe("expandWithCarry", () => {
  const byDay = new Map([
    ["2016-10-28", { eur: 0.91558 }], // a Friday
    ["2016-10-31", { eur: 0.91358 }], // the Monday
  ]);

  it("gives a weekend the preceding Friday's rate and SAYS it did", () => {
    const rows = expandWithCarry(byDay, ["eur"], "2016-10-28", "2016-10-31");
    const saturday = rows.find((r) => r.day === "2016-10-29")!;
    // Zcash's launch day is itself a Saturday, so this is not a hypothetical.
    expect(saturday.rate).toBe(0.91558);
    expect(saturday.rateDay).toBe("2016-10-28");
    expect(saturday.source).toBe("ecb");
  });

  it("marks a published day as its own rate_day", () => {
    const rows = expandWithCarry(byDay, ["eur"], "2016-10-28", "2016-10-31");
    const monday = rows.find((r) => r.day === "2016-10-31")!;
    expect(monday.rateDay).toBe("2016-10-31");
    expect(monday.rate).toBe(0.91358);
  });

  it("emits one row per calendar day in the span", () => {
    const rows = expandWithCarry(byDay, ["eur"], "2016-10-28", "2016-10-31");
    expect(rows.map((r) => r.day)).toEqual([
      "2016-10-28",
      "2016-10-29",
      "2016-10-30",
      "2016-10-31",
    ]);
  });

  it("emits nothing before the first published rate rather than back-filling forward", () => {
    // Carrying BACKWARD would date a rate to before it existed, which is the "never today's
    // rate for a past day" rule pointed at the other end of the series.
    const rows = expandWithCarry(byDay, ["eur"], "2016-10-26", "2016-10-28");
    expect(rows.map((r) => r.day)).toEqual(["2016-10-28"]);
  });
});

describe("parseYahooBtc", () => {
  it("stores the RECIPROCAL, so every currency multiplies the same way", () => {
    const rows = parseYahooBtc(btcUsd);
    const raw = btcUsd as {
      chart: {
        result: { timestamp: number[]; indicators: { quote: { close: (number | null)[] }[] } }[];
      };
    };
    const close = raw.chart.result[0]!.indicators.quote[0]!.close.find((c) => c !== null)!;
    const first = rows[0]!;
    // rate is "units per one USD", so one dollar buys 1/close bitcoin. Storing USD-per-BTC
    // here would make `zecUsd * rate` wrong for this row and right for every fiat row.
    expect(first.rate).toBeCloseTo(1 / close, 12);
    expect(first.currency).toBe("btc");
    expect(first.source).toBe("yahoo");
  });

  it("dates each row to its own day and never carries", () => {
    const rows = parseYahooBtc(btcUsd);
    // BTC trades every day, so there is nothing to carry and rateDay must equal day.
    expect(rows.every((r) => r.rateDay === r.day)).toBe(true);
  });

  it("skips an untraded day rather than interpolating it", () => {
    const rows = parseYahooBtc({
      chart: {
        result: [
          {
            timestamp: [1477612800, 1477699200],
            indicators: { quote: [{ close: [700, null] }] },
          },
        ],
      },
    });
    expect(rows).toHaveLength(1);
  });
});

describe("assembleFxRates", () => {
  const ecb = new Map<string, Record<string, number>>([
    ["2016-10-28", { eur: 0.91, isk: 116 }],
    ["2016-10-31", { eur: 0.92 }], // isk absent -> excluded from the offered set
  ]);
  const btc: FxRate[] = [
    { day: "2016-10-29", currency: "btc", rate: 0.0014, rateDay: "2016-10-29", source: "yahoo" },
  ];

  it("offers only fully-covered fiats, and always BTC", () => {
    const rows = assembleFxRates(ecb, btc, "2016-10-28", "2016-10-31");
    expect(new Set(rows.map((r) => r.currency))).toEqual(new Set(["eur", "btc"]));
  });

  it("carries into a start day the ECB never published — Zcash's launch is a Saturday", () => {
    // The whole reason `backfillFxRates` fetches from the day BEFORE the launch day. Expanding
    // FROM the launch day instead leaves the carry with nothing in hand, and the launch weekend
    // gets no row at all: eur then starts on the Monday, two days short at the front.
    const rows = assembleFxRates(ecb, btc, "2016-10-29", "2016-10-31");
    const launchDay = rows.find((r) => r.day === "2016-10-29" && r.currency === "eur");
    expect(launchDay).toBeDefined();
    expect(launchDay!.rate).toBe(0.91);
    expect(launchDay!.rateDay).toBe("2016-10-28");
  });

  it("emits no row before the requested start day", () => {
    const rows = assembleFxRates(ecb, btc, "2016-10-29", "2016-10-31");
    expect(rows.every((r) => r.day >= "2016-10-29")).toBe(true);
  });

  it("carries the fiat across the weekend but dates BTC to its own day", () => {
    const rows = assembleFxRates(ecb, btc, "2016-10-28", "2016-10-31");
    expect(rows.find((r) => r.day === "2016-10-29" && r.currency === "eur")!.rateDay).toBe(
      "2016-10-28",
    );
    expect(rows.find((r) => r.day === "2016-10-29" && r.currency === "btc")!.rateDay).toBe(
      "2016-10-29",
    );
  });
});
