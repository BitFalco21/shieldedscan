import { describe, expect, it } from "vitest";
import { crossRateError, PASS_MAX_PCT, PASS_MEDIAN_PCT, rateAgreement } from "../fx-alignment";

/**
 * The gate that decides whether a derived cross-rate may be written at all. Measured on live
 * data, the EUR cross-rate agrees with Kraken's traded ZEC/EUR to a median 0.257% and the BTC one
 * with Binance's ZECBTC to 0.100%, against a median 2.2% between the two USD sources already in
 * `zec_price_daily`. The thresholds sit well above the measured figures and far below 2.2%: the
 * failure caught is gross (a reciprocal stored the wrong way up is off by orders of magnitude).
 */
describe("crossRateError", () => {
  const usd = new Map([
    ["2026-01-01", 100],
    ["2026-01-02", 110],
    ["2026-01-03", 120],
  ]);

  it("reports zero error when the traded series is exactly the cross-rate", () => {
    const rates = new Map([
      ["2026-01-01", 0.9],
      ["2026-01-02", 0.9],
      ["2026-01-03", 0.9],
    ]);
    const traded = new Map([
      ["2026-01-01", 90],
      ["2026-01-02", 99],
      ["2026-01-03", 108],
    ]);
    const check = crossRateError(usd, rates, traded)!;
    expect(check.days).toBe(3);
    expect(check.medianPct).toBeCloseTo(0, 9);
  });

  it("catches a reciprocal stored the wrong way up", () => {
    // The single most likely implementation error, and it must fail loudly rather than
    // storing a rate that is off by orders of magnitude.
    const rates = new Map([
      ["2026-01-01", 1 / 0.9],
      ["2026-01-02", 1 / 0.9],
      ["2026-01-03", 1 / 0.9],
    ]);
    const traded = new Map([
      ["2026-01-01", 90],
      ["2026-01-02", 99],
      ["2026-01-03", 108],
    ]);
    expect(crossRateError(usd, rates, traded)!.medianPct).toBeGreaterThan(PASS_MAX_PCT);
  });

  it("compares only days present in all three series", () => {
    const rates = new Map([["2026-01-01", 0.9]]);
    const traded = new Map([
      ["2026-01-01", 90],
      ["2026-01-09", 1],
    ]);
    expect(crossRateError(usd, rates, traded)!.days).toBe(1);
  });

  it("returns null rather than a passing verdict when nothing overlaps", () => {
    // A vendor outage returning an empty series must not read as "validated".
    expect(crossRateError(usd, new Map(), new Map())).toBeNull();
  });

  it("keeps the thresholds above the measured figures and below the published disagreement", () => {
    expect(PASS_MEDIAN_PCT).toBeGreaterThan(0.26); // measured EUR median
    expect(PASS_MEDIAN_PCT).toBeLessThan(2.2); // the USD sources' own median disagreement
    expect(PASS_MAX_PCT).toBeGreaterThan(3.6); // measured EUR max
  });
});

describe("rateAgreement", () => {
  it("reports near-zero disagreement between two vendors quoting the same rate", () => {
    const ecb = new Map([
      ["2026-01-02", 0.9],
      ["2026-01-03", 0.91],
    ]);
    const yahoo = new Map([
      ["2026-01-02", 0.9009],
      ["2026-01-03", 0.9091],
    ]);
    const check = rateAgreement(ecb, yahoo)!;
    expect(check.days).toBe(2);
    expect(check.medianPct).toBeLessThan(0.2);
  });

  it("catches an inverted quote", () => {
    // USDEUR=X vs EURUSD=X is the mistake this arm exists to catch: both are plausible
    // tickers and only one is units-per-USD.
    const ecb = new Map([["2026-01-02", 0.9]]);
    const inverted = new Map([["2026-01-02", 1 / 0.9]]);
    expect(rateAgreement(ecb, inverted)!.medianPct).toBeGreaterThan(10);
  });

  it("returns null when no day overlaps rather than a passing verdict", () => {
    expect(rateAgreement(new Map([["2026-01-02", 0.9]]), new Map())).toBeNull();
  });
});
