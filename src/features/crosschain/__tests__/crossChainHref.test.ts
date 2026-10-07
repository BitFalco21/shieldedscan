import { describe, expect, it } from "vitest";
import type { CrossChainDirection, CrossChainFlow } from "@/domain";
import { CHART_RANGES, parseChartRange } from "@/domain";
import {
  EMPTY_CROSSCHAIN_FILTERS,
  type CrossChainFilterState,
  crossChainHref,
  flowsHref,
  isFiltered,
  withChainToggled,
  withDirection,
  withSideCleared,
} from "../crossChainHref";

/**
 * A flow row with the swap-time USD terms defaulted to their unmeasured state. These tests
 * are about URL building, so the dollars are not the subject — but they are required fields, and a
 * zero covered-count is what says "no venue published a price here" rather than "$0 crossed".
 */
const flow = (
  chain: string,
  direction: CrossChainDirection,
  transfers: number,
  zecAmountZat: number,
): CrossChainFlow => ({
  chain,
  direction,
  transfers,
  zecAmountZat,
  usdAtSwap: 0,
  usdCoveredTransfers: 0,
});

const chains: CrossChainFlow[] = [
  flow("BTC", "in", 1, 900),
  flow("ETH", "in", 1, 400),
  flow("SOL", "out", 1, 500),
];

/**
 * The richest state the UI can actually produce: a venue, and one end filtered by chains.
 *
 * Both ends at once is deliberately not modelled here — choosing a source chain pins the
 * direction to inbound and clears the destination, because a transfer is (direction,
 * counterpart chain) rather than two independent ends.
 */
const everything: CrossChainFilterState = {
  protocol: "maya",
  direction: "in",
  sourceChains: ["BTC", "ETH"],
  destinationChains: [],
  minUsd: null,
};

const paramsOf = (href: string) => new URLSearchParams(href.split("?")[1] ?? "");

describe("crossChainHref", () => {
  it("an unfiltered state is the bare path, so the default view keeps one cache key", () => {
    expect(crossChainHref(EMPTY_CROSSCHAIN_FILTERS)).toBe("/cross-chain");
  });

  it("carries every filter in force, and omits the end that is not filtered", () => {
    const params = paramsOf(crossChainHref(everything));
    expect(params.get("protocol")).toBe("maya");
    expect(params.get("direction")).toBe("in");
    expect(params.get("source")).toBe("BTC,ETH");
    expect(params.has("destination")).toBe(false);
    // And the other end, from an outbound state.
    const out = paramsOf(crossChainHref(withChainToggled(everything, "destination", "SOL")));
    expect(out.get("destination")).toBe("SOL");
    expect(out.has("source")).toBe(false);
  });

  it("a filter link carries no cursor, so changing a filter resets to the newest page", () => {
    // A cursor names a position in a list that no longer exists once the list changes.
    for (const href of [
      crossChainHref({ ...everything, protocol: "near-intents" }),
      crossChainHref(withDirection(everything, "out", chains)),
      crossChainHref(withChainToggled(everything, "source", "BTC")),
      crossChainHref(withSideCleared(everything, "source")),
    ]) {
      const params = paramsOf(href);
      expect(params.has("before")).toBe(false);
      expect(params.has("after")).toBe(false);
    }
  });

  it("a pagination link carries the cursor AND every filter", () => {
    const params = paramsOf(crossChainHref(everything, { before: "cursor-1" }));
    expect(params.get("before")).toBe("cursor-1");
    expect(params.get("protocol")).toBe("maya");
    expect(params.get("source")).toBe("BTC,ETH");
  });
});

describe("no control clears another", () => {
  // The venue is independent of the chain selection and must survive every chain operation, and
  // vice versa. Direction is the exception by design: it follows the chain selection, which
  // makes an impossible both-ends view unreachable.
  it("changing the venue keeps the direction and the chains", () => {
    const params = paramsOf(crossChainHref({ ...everything, protocol: "near-intents" }));
    expect(params.get("protocol")).toBe("near-intents");
    expect(params.get("direction")).toBe("in");
    expect(params.get("source")).toBe("BTC,ETH");
  });

  it("adding a chain keeps the venue", () => {
    const params = paramsOf(crossChainHref(withChainToggled(everything, "source", "SOL")));
    expect(params.get("protocol")).toBe("maya");
    expect(params.get("source")).toBe("BTC,ETH,SOL");
  });

  it("clearing a side keeps the venue and the direction", () => {
    const params = paramsOf(crossChainHref(withSideCleared(everything, "source")));
    expect(params.get("protocol")).toBe("maya");
    expect(params.get("direction")).toBe("in");
    expect(params.has("source")).toBe(false);
  });
});

describe("withDirection", () => {
  it("prunes a selection the new direction cannot offer", () => {
    // Under OUTBOUND every source is Zcash, so a source of BTC is unreachable rather than
    // merely empty — carrying it over would leave a reader at an empty table holding a chip
    // for a chain the menu no longer lists.
    const next = withDirection(everything, "out", chains);
    expect(next.sourceChains).toEqual([]);
    expect(next.destinationChains).toEqual([]);
  });

  it("keeps a selection the new direction still offers", () => {
    const outbound: CrossChainFilterState = {
      ...EMPTY_CROSSCHAIN_FILTERS,
      destinationChains: ["SOL"],
    };
    expect(withDirection(outbound, "out", chains).destinationChains).toEqual(["SOL"]);
  });

  it("prunes nothing when the chain list is unreadable, so a filter stays escapable", () => {
    // With no options at all, pruning against them would silently empty the URL and the
    // active-filter chips with it — leaving the reader filtered with nothing to clear.
    const next = withDirection(everything, "in", []);
    expect(next.sourceChains).toEqual([]);
    expect(next.direction).toBe("in");
  });
});

describe("withChainToggled", () => {
  it("adds, removes, and keeps one selection to one URL", () => {
    const added = withChainToggled(EMPTY_CROSSCHAIN_FILTERS, "source", "ETH");
    expect(added.sourceChains).toEqual(["ETH"]);
    expect(withChainToggled(added, "source", "BTC").sourceChains).toEqual(["BTC", "ETH"]);
    expect(withChainToggled(added, "source", "ETH").sourceChains).toEqual([]);
  });

  it("pins the direction the chosen side implies, and clears the other", () => {
    // This is what makes the impossible states unreachable rather than merely empty: a
    // foreign SOURCE chain only exists on an inbound transfer, so naming one IS choosing
    // inbound, and no destination chain can survive alongside it.
    const src = withChainToggled(EMPTY_CROSSCHAIN_FILTERS, "source", "BTC");
    expect(src).toMatchObject({ direction: "in", sourceChains: ["BTC"], destinationChains: [] });

    const dst = withChainToggled(EMPTY_CROSSCHAIN_FILTERS, "destination", "SOL");
    expect(dst).toMatchObject({ direction: "out", sourceChains: [], destinationChains: ["SOL"] });

    // Switching ends replaces the selection rather than accumulating a contradiction.
    const swapped = withChainToggled(everything, "destination", "SOL");
    expect(swapped).toMatchObject({
      direction: "out",
      sourceChains: [],
      destinationChains: ["SOL"],
    });
  });

  it("leaves the direction alone when the last chain is removed", () => {
    // The reader chose that view; widening it back to both directions under them would be
    // the page changing by itself.
    const emptied = withChainToggled({ ...everything, sourceChains: ["BTC"] }, "source", "BTC");
    expect(emptied.sourceChains).toEqual([]);
    expect(emptied.direction).toBe("in");
  });

  it("keeps the venue through every toggle", () => {
    expect(withChainToggled(everything, "destination", "SOL").protocol).toBe("maya");
  });
});

describe("isFiltered", () => {
  it("is false only when nothing narrows the list", () => {
    expect(isFiltered(EMPTY_CROSSCHAIN_FILTERS)).toBe(false);
    expect(isFiltered({ ...EMPTY_CROSSCHAIN_FILTERS, sourceChains: ["BTC"] })).toBe(true);
    expect(isFiltered({ ...EMPTY_CROSSCHAIN_FILTERS, destinationChains: ["ZEC"] })).toBe(true);
    expect(isFiltered({ ...EMPTY_CROSSCHAIN_FILTERS, direction: "in" })).toBe(true);
  });
});

describe("flowsHref", () => {
  it("gives ALL a bare path, so the default view is one URL and one cache key", () => {
    expect(flowsHref("all")).toBe("/cross-chain/flows");
  });

  /*
   * A round trip, not a list of expected strings. The href builder and the parser are the two
   * halves of one contract, and a test that spells out `?range=30d` on both sides passes even
   * when they agree on something the other end never reads.
   */
  it("round trips every range back through the parser", () => {
    for (const range of CHART_RANGES) {
      const href = flowsHref(range.value);
      const query = href.split("?")[1];
      expect(parseChartRange(new URLSearchParams(query).get("range") ?? undefined)).toBe(
        range.value,
      );
    }
  });
});
