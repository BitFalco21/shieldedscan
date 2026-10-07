import { describe, expect, it } from "vitest";
import { parseKrakenCandles, parseKrakenTicker, spliceAllTime } from "../kraken";
import ticker from "../__fixtures__/kraken-ticker.json";
import ohlc from "../__fixtures__/kraken-ohlc-1440.json";

/**
 * Both fixtures are real captured responses, not hand-written shapes: Kraken's documentation
 * describes the ticker fields correctly and its pair naming misleadingly.
 */
describe("parseKrakenTicker", () => {
  it("reads the last trade from a real response", () => {
    const quote = parseKrakenTicker(ticker, 1_000);
    expect(quote).not.toBeNull();
    expect(quote!.usd).toBeGreaterThan(0);
    expect(quote!.fetchedAt).toBe(1_000);
  });

  it("answers under the venue's canonical pair name, not the requested one", () => {
    // We ask for ZECUSD; the response is keyed XZECZUSD. A parser keyed on the request
    // returns null on every call, and one keyed on the literal breaks on any rename.
    expect(Object.keys((ticker as { result: object }).result)).not.toContain("ZECUSD");
    expect(parseKrakenTicker(ticker, 1)).not.toBeNull();
  });

  it("derives the change from today's open, not from a 24-hour-ago price", () => {
    const body = { error: [], result: { XZECZUSD: { c: ["110.0", "1"], o: "100.0" } } };
    expect(parseKrakenTicker(body, 1)!.changeTodayPct).toBeCloseTo(10, 10);
  });

  it("withholds the change rather than fabricating a zero one when the open is missing", () => {
    // A 0.0% move is a finding; a missing open is not one, so the change is null, never 0.
    const body = { error: [], result: { XZECZUSD: { c: ["110.0", "1"] } } };
    expect(parseKrakenTicker(body, 1)!.changeTodayPct).toBeNull();
  });

  it("refuses an error envelope, a missing price and a multi-pair result", () => {
    expect(parseKrakenTicker({ error: ["EQuery:Unknown asset pair"], result: {} }, 1)).toBeNull();
    expect(parseKrakenTicker({ error: [], result: { XZECZUSD: { o: "1" } } }, 1)).toBeNull();
    expect(
      parseKrakenTicker({ error: [], result: { A: { c: ["1", "1"] }, B: { c: ["2", "1"] } } }, 1),
    ).toBeNull();
  });
});

describe("parseKrakenCandles", () => {
  it("takes the CLOSE from a real OHLC row", () => {
    const points = parseKrakenCandles(ohlc);
    expect(points).not.toBeNull();
    expect(points!.length).toBeGreaterThan(1);
    // [time, open, high, low, close, vwap, volume, count] — index 4, never index 1.
    const rows = (ohlc as { result: Record<string, unknown> }).result;
    const key = Object.keys(rows).filter((k) => k !== "last")[0]!;
    const first = (rows[key] as unknown[][])[0]!;
    expect(points![0]!.usd).toBe(Number(first[4]));
    expect(points![0]!.t).toBe(Number(first[0]));
  });

  it("is ordered oldest first, which is what the chart draws along x", () => {
    const points = parseKrakenCandles(ohlc)!;
    for (let i = 1; i < points.length; i++) {
      expect(points[i]!.t).toBeGreaterThan(points[i - 1]!.t);
    }
  });

  it("returns null rather than an empty series when nothing parses", () => {
    // An empty array would claim ZEC did not trade; null renders as unavailable.
    expect(parseKrakenCandles({ error: [], result: { X: [] } })).toBeNull();
    expect(parseKrakenCandles({ error: ["EGeneral:Invalid arguments"], result: {} })).toBeNull();
  });
});

describe("spliceAllTime", () => {
  const stored = [
    { t: 100, usd: 10 },
    { t: 200, usd: 20 },
    { t: 300, usd: 30 },
  ];
  const venue = [
    { t: 200, usd: 21 },
    { t: 300, usd: 33 },
  ];

  it("keeps stored history only for days the venue does not reach", () => {
    expect(spliceAllTime(stored, venue)).toEqual([
      { t: 100, usd: 10 },
      { t: 200, usd: 21 },
      { t: 300, usd: 33 },
    ]);
  });

  it("ends on the venue's own close, so every range agrees with the headline", () => {
    // The two sources differ by a couple of percent on any given day. If the all-time chart
    // ended on the stored close while the figure above it came from the venue, the seam
    // would be visible on toggling ranges — which is the whole reason for splicing.
    const spliced = spliceAllTime(stored, venue);
    expect(spliced[spliced.length - 1]).toEqual({ t: 300, usd: 33 });
  });

  it("falls back to stored history when the venue has nothing", () => {
    expect(spliceAllTime(stored, [])).toEqual(stored);
  });
});
