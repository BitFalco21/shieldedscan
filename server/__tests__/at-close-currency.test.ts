import { describe, expect, it } from "vitest";
import { type DayClose, usdAtCloseFor } from "../analytics-routes";

/**
 * "Worth at the time", in a currency other than the dollar.
 *
 * Each map value is a record's own day, its close and that day's rate, as the SQL that joins the
 * record's day reads them. Exported for this test because the refusal below is the one behaviour here that a route
 * test cannot reach without a populated matview, and it is the behaviour that matters most.
 */
const ONE_ZEC = 100_000_000;
const closes = new Map<number, DayClose>([
  // a close AND a rate for that day
  [100, { day: "2019-05-01", usd: 50, source: "yahoo", rate: 0.895 }],
  // a close, no rate — the gap case
  [200, { day: "2019-05-02", usd: 50, source: "yahoo", rate: null }],
]);

describe("usdAtCloseFor", () => {
  it("is unchanged for dollars", () => {
    const text = usdAtCloseFor(closes, ONE_ZEC, 100)!;
    expect(text).toContain("$50");
    expect(text).toContain("2019-05-01");
    expect(text).toContain("yahoo");
    expect(text).not.toContain("reference rate");
  });

  it("converts at THAT DAY's rate, and says it did", () => {
    const text = usdAtCloseFor(closes, ONE_ZEC, 100, "eur")!;
    // 1 ZEC at $50 with 1 USD = 0.895 EUR is €44.75.
    expect(text).toContain("€44.75");
    // Both terms named: a reader entitled to check the price is entitled to check the rate.
    expect(text).toContain("$50.00");
    expect(text).toContain("USD→EUR reference rate");
    // And the standing caveat survives, in the string rather than beside it.
    expect(text).toContain("not today's value");
    expect(text).toContain("not a price quoted on a EUR market");
  });

  it("returns NULL when the day has a close but no rate — never the dollar figure", () => {
    // The whole point. A dollar amount under a euro heading is a well-formed answer to a
    // question nobody asked, and nothing downstream could catch it.
    expect(usdAtCloseFor(closes, ONE_ZEC, 200, "eur")).toBeNull();
    // The dollar path for the same record still works, so this is a lost conversion and not
    // a lost record.
    expect(usdAtCloseFor(closes, ONE_ZEC, 200)).toContain("$50");
  });

  it("returns null for a height with no close at all, in any currency", () => {
    expect(usdAtCloseFor(closes, ONE_ZEC, 999)).toBeNull();
    expect(usdAtCloseFor(closes, ONE_ZEC, 999, "eur")).toBeNull();
    expect(usdAtCloseFor(closes, ONE_ZEC, null, "eur")).toBeNull();
  });
});
