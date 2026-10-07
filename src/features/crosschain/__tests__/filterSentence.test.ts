import { describe, expect, it } from "vitest";
import { filterSentence, isUnsatisfiable } from "../transferView";
import { EMPTY_CROSSCHAIN_FILTERS, type CrossChainFilterState } from "../crossChainHref";

const state = (over: Partial<CrossChainFilterState> = {}): CrossChainFilterState => ({
  ...EMPTY_CROSSCHAIN_FILTERS,
  ...over,
});

/**
 * The totals line above the table, which quotes an exact count and then says what it
 * counted. Four optional clauses that compose, so the cases below are combinations rather
 * than a single happy path — the count itself is `countCrossChainTransfers` run with the
 * same filters as the list, so the risk here is the sentence describing a different set
 * from the one that was counted.
 */
describe("filterSentence", () => {
  it("names each filter in force", () => {
    expect(filterSentence(state({ direction: "in" }))).toBe("inbound cross-chain transactions");
    expect(filterSentence(state({ protocol: "maya" }))).toBe("cross-chain transactions on maya");
    expect(filterSentence(state({ sourceChains: ["BTC"] }))).toBe(
      "cross-chain transactions from BTC",
    );
    expect(filterSentence(state({ destinationChains: ["SOL"] }))).toBe(
      "cross-chain transactions to SOL",
    );
  });

  it("composes all four", () => {
    expect(
      filterSentence(
        state({
          direction: "out",
          protocol: "near-intents",
          sourceChains: ["ZEC"],
          destinationChains: ["SOL", "TRON"],
        }),
      ),
    ).toBe("outbound cross-chain transactions on near-intents from ZEC to SOL or TRON");
  });

  it("folds a long selection rather than listing sixteen chains", () => {
    expect(filterSentence(state({ sourceChains: ["BTC", "ETH", "SOL"] }))).toBe(
      "cross-chain transactions from BTC, ETH or SOL",
    );
    expect(filterSentence(state({ sourceChains: ["BTC", "ETH", "SOL", "TRON", "ARB"] }))).toBe(
      "cross-chain transactions from BTC, ETH, SOL or 2 more",
    );
  });

  it("says nothing about a filter that is not applied", () => {
    // The line only renders when something is filtering, but it must not invent clauses for
    // the parts that are not — "on all venues" would describe our plumbing, not the data.
    expect(filterSentence(EMPTY_CROSSCHAIN_FILTERS)).toBe("cross-chain transactions");
  });
});

/**
 * Both-ends selections are unreachable from the UI now that choosing a chain pins the
 * direction — but a URL can still carry one, so the page must recognise the two shapes that
 * no row can ever match and say so, rather than reading as "the chain is quiet".
 */
describe("isUnsatisfiable", () => {
  const both = (sourceChains: string[], destinationChains: string[]) =>
    isUnsatisfiable(state({ sourceChains, destinationChains }));

  it("is false whenever only one end is named — the normal case", () => {
    expect(both(["BTC"], [])).toBe(false);
    expect(both([], ["SOL"])).toBe(false);
    expect(both([], [])).toBe(false);
  });

  it("is false for the two shapes that DO exist", () => {
    expect(both(["BTC"], ["ZEC"])).toBe(false); // inbound from BTC
    expect(both(["ZEC"], ["SOL"])).toBe(false); // outbound to SOL
    expect(both(["BTC", "ZEC"], ["ZEC", "SOL"])).toBe(false); // both still satisfiable
  });

  it("is true for two foreign ends — the route nobody indexes", () => {
    expect(both(["BTC"], ["ETH"])).toBe(true);
  });

  it("is true for ZEC at BOTH ends — inbound and outbound at once", () => {
    // The case a "two foreign chains" test misses, which is why the predicate is written from
    // the shapes that exist.
    expect(both(["ZEC"], ["ZEC"])).toBe(true);
  });
});
