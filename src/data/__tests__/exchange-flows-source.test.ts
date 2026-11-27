import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { flowsQuery, parseExchangeFlows, parseExchangeMovements } from "../exchange-flows-source";

/** Captured from production on 2026-11-27, points cut to three. */
const flows = () =>
  JSON.parse(
    readFileSync("src/data/__tests__/__fixtures__/exchange-flows-v1.json", "utf8"),
  ) as Record<string, unknown>;
const movements = () =>
  JSON.parse(
    readFileSync("src/data/__tests__/__fixtures__/exchange-movements-v1.json", "utf8"),
  ) as Record<string, unknown>;

const ASKED = { from: "2026-10-28", to: "2026-11-28", interval: "day" as const };

describe("the exchange flows adapter", () => {
  it("reads a real answer onto the domain shape", () => {
    const w = parseExchangeFlows(flows(), ASKED, 30);
    expect(w.counted).toEqual({
      from: Date.UTC(2026, 9, 28) / 1000,
      to: Date.UTC(2026, 10, 26) / 1000,
    });
    expect(Object.keys(w.totals)).toHaveLength(8);
    const b = w.totals.binance!;
    // Its parts add up to its side, in each direction.
    expect(b.in.parts.reduce((s, p) => s + p.zat, 0)).toBe(b.in.zat);
    expect(b.out.parts.reduce((s, p) => s + p.zat, 0)).toBe(b.out.zat);
    expect(w.points).toHaveLength(3);
    expect(w.points[0]!.timestamp).toBe(Date.UTC(2026, 9, 28) / 1000);
    expect(w.points[0]!.all).toEqual({
      inZat: 865_880_317_309,
      outZat: 2_031_047_317_520,
      betweenZat: 0,
    });
    expect(w.notes[0]).toMatch(/Counted through 2026-11-26/);
  });

  it("refuses an answer for another window, which would read as this one", () => {
    expect(() => parseExchangeFlows(flows(), { ...ASKED, from: "2026-10-01" }, 30)).toThrow(
      /different window/,
    );
    expect(() => parseExchangeFlows(flows(), { ...ASKED, interval: "month" }, 30)).toThrow(
      /different window/,
    );
  });

  it("fails loudly on an exchange missing from an answer, never a blank row", () => {
    const body = flows();
    const data = body.data as { totals: { exchanges: Record<string, unknown> } };
    delete data.totals.exchanges.gate;
    expect(() => parseExchangeFlows(body, ASKED, 30)).toThrow(/gate is missing/);
  });

  it("reads an exchange this build does not know yet as an unnamed exchange, never an error", () => {
    const body = flows();
    const binance = (
      body.data as { totals: { exchanges: Record<string, { out: { parts: unknown[] } }> } }
    ).totals.exchanges.binance!;
    binance.out.parts.push({
      kind: "exchange",
      exchange: "bybit",
      value: { zat: 5, zec: "0.00000005" },
    });
    const part = parseExchangeFlows(body, ASKED, 30).totals.binance!.out.parts.at(-1);
    expect(part).toEqual({ kind: "exchange", exchange: null, zat: 5 });
  });

  it("keeps an exchange the API could not count as null", () => {
    const body = flows();
    (body.data as { totals: { exchanges: Record<string, unknown> } }).totals.exchanges.okx = null;
    expect(parseExchangeFlows(body, ASKED, 30).totals.okx).toBeNull();
  });

  it("reads the largest movements and checks their echo", () => {
    const m = parseExchangeMovements(movements(), {
      from: "2026-10-28",
      to: "2026-11-28",
      exchange: null,
    });
    expect(m).toHaveLength(3);
    expect(m[0]!.zat).toBeGreaterThanOrEqual(m[1]!.zat);
    expect(m[0]!.parts.reduce((s, p) => s + p.zat, 0)).toBe(m[0]!.zat);
    expect(() =>
      parseExchangeMovements(movements(), {
        from: "2026-10-28",
        to: "2026-11-28",
        exchange: "gate",
      }),
    ).toThrow(/different window or exchange/);
    // A movement of an exchange this build does not know is left out, not the whole list.
    const body = movements();
    (body.items as { exchange: string }[])[0]!.exchange = "bybit";
    expect(
      parseExchangeMovements(body, { from: "2026-10-28", to: "2026-11-28", exchange: null }),
    ).toHaveLength(2);
  });

  it("asks a window with both edges, the end exclusive and covering today", () => {
    const now = Date.UTC(2026, 10, 27, 15) / 1000;
    expect(flowsQuery(30, now)).toEqual({
      from: "2026-10-28",
      to: "2026-11-28",
      interval: "day",
    });
    expect(flowsQuery(null, now)).toEqual({ from: null, to: null, interval: "month" });
  });
});
