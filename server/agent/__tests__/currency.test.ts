import { describe, expect, it } from "vitest";
import { AgentTools } from "../tools";
import { MemoryFxRates } from "../../fx-rates";
import { makeV1, makeChain, FIXTURE_NOW_MS } from "../testing/fixture-world";

/**
 * A reader asking for a figure in something other than dollars. The model may not multiply, so the
 * payload itself must carry the figure in the requested currency.
 */
const withRates = (): AgentTools =>
  new AgentTools(
    makeV1(),
    makeChain(),
    () => FIXTURE_NOW_MS,
    new MemoryFxRates(["usd", "eur", "btc"], { eur: 0.86, btc: 0.0000091 }, {}),
  );

const payloadOf = (content: string): string => content;

describe("valuing in another currency", () => {
  it("values pool balances in the requested currency, not dollars", async () => {
    const result = await withRates().dispatch(
      "chain_status",
      JSON.stringify({ include: ["supply"], currency: "eur" }),
    );
    expect(payloadOf(result.content)).toContain("€");
    // The dollar sign must be gone from the valuations, or the answer carries both and the model
    // picks. A figure in two currencies is a figure in neither.
    expect(result.content).not.toMatch(/"balanceValue": "≈ \$/);
  });

  it("ECHOES the currency it applied", async () => {
    const result = await withRates().dispatch(
      "chain_status",
      JSON.stringify({ include: ["supply"], currency: "eur" }),
    );
    // An agent one deploy behind would ignore `currency` and answer in dollars — well-formed,
    // unfalsifiable and wrong. The echo makes that visible.
    expect(result.content).toContain('"currency": "eur"');
    expect(result.content).toContain('"usdToCurrencyRate"');
  });

  it("names both terms the figure rests on, not just the price", async () => {
    const result = await withRates().dispatch(
      "chain_status",
      JSON.stringify({ include: ["supply"], currency: "eur" }),
    );
    // A euro valuation is two claims — a price we polled and a rate the ECB published — and a
    // reader entitled to check one is entitled to check the other.
    expect(result.content).toMatch(/reference rate/i);
    expect(result.content).toMatch(/EUR/);
  });

  it("defaults to dollars, unchanged, when no currency is asked for", async () => {
    const result = await withRates().dispatch(
      "chain_status",
      JSON.stringify({ include: ["supply"] }),
    );
    expect(result.content).toContain('"currency": "usd"');
    expect(result.content).toMatch(/"balanceValue": "≈ \$/);
    // No rate key on the identity case: a "rate: 1" invites the model to mention a conversion
    // that did not happen.
    expect(result.content).not.toContain("usdToCurrencyRate");
  });

  it("REFUSES a currency it holds no rate for, naming it and the alternatives", async () => {
    const result = await withRates().dispatch(
      "chain_status",
      JSON.stringify({ include: ["supply"], currency: "rub" }),
    );
    expect(result.content).toContain("rub");
    expect(result.content).toContain("eur");
    // And it must not have answered anyway: no payload, no dollar figure standing in.
    expect(result.content).not.toContain("balanceValue");
    expect(result.endpoints).toEqual([]);
  });

  it("refuses BEFORE reading anything upstream", async () => {
    // A refusal must not still render a figure; this pins that nothing was fetched at all.
    const result = await withRates().dispatch(
      "chain_status",
      JSON.stringify({ include: ["supply"], currency: "zzz" }),
    );
    expect(result.endpoints).toEqual([]);
    expect(result.content).not.toContain("<data");
  });

  it("carries eight decimals for BTC, so a real holding is not rounded to nothing", async () => {
    const result = await withRates().dispatch(
      "chain_status",
      JSON.stringify({ include: ["supply"], currency: "btc" }),
    );
    expect(result.content).toContain("BTC");
    expect(result.content).not.toMatch(/"balanceValue": "≈ 0\.00 BTC"/);
  });

  it("is case-insensitive, because a reader types EUR as often as eur", async () => {
    const result = await withRates().dispatch(
      "chain_status",
      JSON.stringify({ include: ["supply"], currency: "EUR" }),
    );
    expect(result.content).toContain('"currency": "eur"');
  });
});

describe("the PRICE itself — the question this feature exists for", () => {
  /*
   * The spot price rides on the `chain`/`status` facets, which use a different renderer from the
   * pool balances — so both paths are asserted to convert.
   */
  for (const facet of ["chain", "status"] as const) {
    it(`converts the spot price on the '${facet}' facet`, async () => {
      const result = await withRates().dispatch(
        "chain_status",
        JSON.stringify({ include: [facet], currency: "eur" }),
      );
      expect(result.content).toContain('"priceInCurrency"');
      expect(result.content).toMatch(/"priceInCurrency": "€/);
      expect(result.content).toContain('"currency": "eur"');
    });
  }

  it("keeps the dollar price beside it, so nothing is lost", async () => {
    const result = await withRates().dispatch(
      "chain_status",
      JSON.stringify({ include: ["chain"], currency: "eur" }),
    );
    expect(result.content).toContain('"priceUsd"');
  });

  it("emits NO currency keys at all on the dollar path", async () => {
    // The existing keys already are dollars. A `priceInCurrency` holding the same number
    // beside `priceUsd` would hand the model two names for one fact.
    const result = await withRates().dispatch(
      "chain_status",
      JSON.stringify({ include: ["chain"] }),
    );
    expect(result.content).not.toContain("priceInCurrency");
    expect(result.content).not.toContain("usdToCurrencyRate");
  });
});

describe("per-pool counts: the model is told what a whole-days basis means", () => {
  /*
   * A payload field the model has never been told about is one it will ignore or invent a meaning
   * for, so the note must name it.
   */
  it("names the basis, the day range, and forbids restating the reader's dates", async () => {
    const { CHAIN_WINDOW_NOTE } = await import("../tools");
    expect(CHAIN_WINDOW_NOTE).toMatch(/whole-days/);
    expect(CHAIN_WINDOW_NOTE).toMatch(/fromDay/);
    expect(CHAIN_WINDOW_NOTE).toMatch(/exact-blocks/);
    // The specific wrong answer this prevents: a snapped window presented as the exact one.
    expect(CHAIN_WINDOW_NOTE).toMatch(/rather than repeating the reader's dates/i);
    // And the trap on the wide path: a 0 that is an absence of grain, not a measurement.
    expect(CHAIN_WINDOW_NOTE).toMatch(/transparentOnly.{0,40}NOT MEASURED/s);
  });
});

describe("no stale six-month claim survives anywhere the model reads", () => {
  /*
   * Neither the tool description nor the unavailable-counts wording may assert that per-pool counts
   * are limited to a period; the model splits wide questions into narrow windows if told so. A
   * sweep rather than targeted assertions, because a stale copy can appear anywhere on the tool
   * surface.
   */
  it("no tool description or note tells the model per-pool counts are limited to a period", async () => {
    const { CHAIN_WINDOW_NOTE } = await import("../tools");
    const tools = new (await import("../tools")).AgentTools(
      (await import("../testing/fixture-world")).makeV1(),
      (await import("../testing/fixture-world")).makeChain(),
    );
    const surface = JSON.stringify(tools.defs()) + CHAIN_WINDOW_NOTE;
    // The specific phrasing to guard against, and its general shape.
    expect(surface).not.toMatch(/up to about six months/i);
    expect(surface).not.toMatch(/per pool cheaply/i);
    expect(surface).not.toMatch(/narrower period/i);
  });

  it("the tool description says per-pool counts cover ANY window", async () => {
    const tools = new (await import("../tools")).AgentTools(
      (await import("../testing/fixture-world")).makeV1(),
      (await import("../testing/fixture-world")).makeChain(),
    );
    const activity = tools.defs().find((d) => d.function.name === "chain_activity")!.function
      .description;
    expect(activity).toMatch(/ANY window/);
    expect(activity).toMatch(/never split/i);
  });
});

describe("migration questions route to the tool that can answer them", () => {
  /*
   * The Ironwood topic's three fixed windows are a convenience; its note must point at
   * chain_activity for any other period, or the model refuses a question chain_activity answers.
   */
  it("the Ironwood topic points at chain_activity for any other period", async () => {
    const tools = new (await import("../tools")).AgentTools(
      (await import("../testing/fixture-world")).makeV1(),
      (await import("../testing/fixture-world")).makeChain(),
    );
    const insights = tools.defs().find((d) => d.function.name === "explorer_insights")!.function
      .description;
    expect(insights).toMatch(/chain_activity/);
    expect(insights).toMatch(/all of history/i);
    // And it must not present the three windows as the limit of what exists.
    expect(insights).toMatch(/convenience, not the limit/i);
  });

  it("chain_activity advertises the matrix and its per-day pricing", async () => {
    const tools = new (await import("../tools")).AgentTools(
      (await import("../testing/fixture-world")).makeV1(),
      (await import("../testing/fixture-world")).makeChain(),
    );
    const activity = tools.defs().find((d) => d.function.name === "chain_activity")!.function
      .description;
    expect(activity).toMatch(/MIGRATION MATRIX/i);
    expect(activity).toMatch(/PRICED at its own day/i);
  });
});

describe("the window path carries the currency to the SQL", () => {
  /*
   * The migration matrix is priced day by day, so the currency cannot be applied after the fetch:
   * an all-time total converted at one rate is fiction across a span where ZEC moved tenfold. The
   * tool must therefore send `?currency=`.
   */
  it("sends ?currency= on a non-USD window call, and omits it for dollars", async () => {
    const seen: string[] = [];
    const chain = {
      request: (path: string) => {
        seen.push(path);
        return new Response("{}", { status: 200 });
      },
    };
    const { AgentTools } = await import("../tools");
    const { makeV1, FIXTURE_NOW_MS } = await import("../testing/fixture-world");
    const { MemoryFxRates } = await import("../../fx-rates");
    const tools = new AgentTools(
      makeV1(),
      chain,
      () => FIXTURE_NOW_MS,
      new MemoryFxRates(["usd", "eur"], { eur: 0.86 }, {}),
    );

    await tools.dispatch(
      "chain_activity",
      JSON.stringify({ mode: "window", from: "2025-01-01", to: "2026-01-01", currency: "eur" }),
    );
    expect(seen.some((p) => p.includes("currency=eur"))).toBe(true);

    seen.length = 0;
    await tools.dispatch(
      "chain_activity",
      JSON.stringify({ mode: "window", from: "2025-01-01", to: "2026-01-01" }),
    );
    // Omitted entirely for USD, so an unfiltered request stays byte-identical.
    expect(seen.some((p) => p.includes("currency="))).toBe(false);
  });
});

describe("all of history means omitting the edges", () => {
  /*
   * The window is half-open, so a window ending today excludes today; the note must say that an
   * open window means all of history, or the model describes a window that stops at yesterday as
   * "all of recorded history".
   */
  it("tells the model to omit both edges, and that a passed `to` is excluded", async () => {
    const { CHAIN_WINDOW_NOTE } = await import("../tools");
    expect(CHAIN_WINDOW_NOTE).toMatch(/OMIT `from` AND `to`/);
    expect(CHAIN_WINDOW_NOTE).toMatch(/HALF-OPEN/);
    expect(CHAIN_WINDOW_NOTE).toMatch(/overstates it by a day/);
  });
});
