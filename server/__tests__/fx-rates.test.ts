import { describe, expect, it } from "vitest";
import { MemoryFxRates, resolveCurrency, USD } from "../fx-rates";

/**
 * Resolving a reader's currency to a rate, and refusing when we cannot. The refusal matters most:
 * answering a euro question in dollars because the rate was missing would be a well-formed answer
 * to a different question.
 */
const fx = new MemoryFxRates(
  ["usd", "eur", "jpy", "btc"],
  { eur: 0.86, jpy: 147.2, btc: 0.0000091 },
  { "2019-05-01": { eur: 0.895 } },
);

describe("resolveCurrency", () => {
  it("defaults to USD at rate 1, which is the identity case", () => {
    expect(resolveCurrency(undefined, fx)).toEqual({ ok: true, currency: "usd", rate: 1 });
  });

  it("accepts a currency we carry, case-insensitively", () => {
    expect(resolveCurrency("EUR", fx)).toEqual({ ok: true, currency: "eur", rate: 0.86 });
  });

  it("REFUSES a currency we do not carry, naming it", () => {
    const out = resolveCurrency("rub", fx);
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("unreachable");
    // Named, so the model can say which currency and not merely that something failed.
    expect(out.reason).toContain("rub");
    // And the offered set travels with the refusal, so the answer can offer an alternative.
    expect(out.reason).toContain("eur");
  });

  it("refuses rather than silently falling back to dollars", () => {
    const out = resolveCurrency("xyz", fx);
    expect(out.ok).toBe(false);
    expect(JSON.stringify(out)).not.toContain('"rate":1');
  });

  it("refuses a currency in the offered list whose rate has not loaded", () => {
    // Offered but unrateable is an outage, not a valuation of zero. Same distinction the
    // nullable priceUsd draws, and the reason the fabricated $38.42 could happen at all.
    const cold = new MemoryFxRates(["usd", "eur"], {}, {});
    expect(resolveCurrency("eur", cold).ok).toBe(false);
  });

  it("treats USD as always available, even with no rates loaded", () => {
    const cold = new MemoryFxRates(["usd"], {}, {});
    expect(resolveCurrency(USD, cold)).toEqual({ ok: true, currency: "usd", rate: 1 });
  });
});

describe("historical lookup", () => {
  it("returns a specific day's rate", async () => {
    expect(await fx.on("2019-05-01", "eur")).toBe(0.895);
  });

  it("returns 1 for USD on any day without consulting anything", async () => {
    expect(await fx.on("1999-01-01", "usd")).toBe(1);
  });

  it("returns null for a day we have no rate for, never today's rate", async () => {
    // Valuing a past day at today's rate is the fabrication this whole design refuses.
    expect(await fx.on("2019-05-02", "eur")).toBeNull();
  });
});
