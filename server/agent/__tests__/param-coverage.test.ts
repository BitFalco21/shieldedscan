import { afterEach, describe, expect, it, vi } from "vitest";
import { createCrossChainApiSource } from "@/data/crosschain-api-source";
import type { CrossChainFilters } from "@/data/source";
import { MemoryFxRates } from "../../fx-rates";
import { AgentTools, type ToolName } from "../tools";
import { makeV1, makeChain, FIXTURE_NOW_MS } from "../testing/fixture-world";

/**
 * Parameter coverage — the mirror of `routing-coverage.test.ts`. That gate reads the quantities a
 * payload carries and fails when the tool's description has no word for one. This one covers the
 * step before: a filter the tool cannot send never appears in any payload, so nothing downstream
 * can notice it is missing — there is only a question that routes nowhere.
 *
 * The invariant, stated in the site's terms: a narrowing a reader can apply on a page must be one
 * the agent can apply too. Both sides derive from shipping code:
 *
 *  - the site side by driving the real adapter against a recording fetch, so the parameters are the
 *    ones it actually puts on the wire;
 *  - the agent side by dispatching the tool through arguments the schema declares, because the
 *    schema is all a model can send. A dispatch table alone would pass as soon as the
 *    query-building line existed, while the model still could not reach it.
 *
 * A gap is closed by adding the parameter, or declared in `EXPRESSED_BY` with the parameter that
 * covers the same ground; declarations are themselves checked, so an excuse naming a parameter the
 * tool has lost fails.
 */

const CONFIG = { baseUrl: "https://api.example", token: "secret" };

/** Every narrowing a reader can set on `/cross-chain`, as one filter object. */
const EVERY_FILTER: CrossChainFilters = {
  protocol: "maya",
  direction: "in",
  sourceChains: ["BTC"],
  destinationChains: ["ETH"],
  minUsdAtSwap: 10_000,
};

/**
 * The wire parameters the site's own adapter sends, recorded from the real code. The stub answers
 * the adapter's echo truthfully, because a mismatch throws, and a throw here would silently shrink
 * the recorded set.
 */
async function siteParams(): Promise<Set<string>> {
  const urls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    urls.push(url);
    return new Response(
      JSON.stringify({
        // One body answering all three validators. Each throws on a shape it does not recognise,
        // which would drop that method's parameters from the recorded set.
        items: [],
        nextCursor: null,
        prevCursor: null,
        applied: {
          sourceChains: EVERY_FILTER.sourceChains,
          destinationChains: EVERY_FILTER.destinationChains,
          minUsdAtSwap: EVERY_FILTER.minUsdAtSwap,
        },
        total: 0,
        flows: [],
        firstAt: 0,
        lastAt: 1,
        windowDays: 30,
        previous: { kind: "none" },
      }),
      { status: 200 },
    );
  });
  const source = createCrossChainApiSource(CONFIG);
  await source.listCrossChainTransfers({ limit: 25 }, EVERY_FILTER);
  await source.countCrossChainTransfers(EVERY_FILTER);
  await source.getCrossChainFlows(30);

  const params = new Set<string>();
  for (const url of urls) {
    for (const key of new URL(url).searchParams.keys()) params.add(key);
  }
  // Paging is not a narrowing: it says where in an answer to resume, never which answer.
  for (const key of ["limit", "before", "after", "cursor"]) params.delete(key);
  return params;
}

/**
 * Dispatches whose arguments are all schema-declared, one per narrowing the tool offers.
 * Hand-written and held against the schema below, so the schema decides whether the table is
 * complete.
 */
const CROSSCHAIN_CALLS: Record<string, unknown>[] = [
  { mode: "aggregate", venue: "maya" },
  { mode: "aggregate", direction: "in" },
  { mode: "aggregate", chain: "BTC" },
  { mode: "aggregate", from: "2026-07-01", to: "2026-08-01" },
  // The trailing window has no site equivalent (the flows tab's `days` covers only presets). It is
  // exercised so the schema check reaches it: a query parameter the tool builds but no property
  // declares is reachable by our code and by no model.
  { mode: "aggregate", lastDays: 46 },
  { mode: "aggregate", groupBy: "chain" },
  { mode: "aggregate", minUsdAtSwap: 10_000 },
  // The ZEC floor has no site equivalent (the chips are dollars); exercised so the schema check
  // reaches it.
  { mode: "aggregate", minZec: 5_000 },
  { mode: "transfers", sort: "largest", minZec: 5_000 },
  { mode: "transfers", sort: "largest", by: "usd", limit: 3 },
  { mode: "destinations" },
  // Not a narrowing of which rows but the currency the money figures are denominated in; exercised
  // for the same reason as `lastDays` and `minZec`.
  { mode: "aggregate", currency: "eur" },
];

function tools() {
  // A rateable currency, or the `currency` row is refused and proves nothing.
  return new AgentTools(
    makeV1(),
    makeChain(),
    () => FIXTURE_NOW_MS,
    new MemoryFxRates(["usd", "eur"], { eur: 0.86 }, {}),
  );
}

/** Property names the tool's own JSON schema declares — the whole of what a model may send. */
function declaredProperties(tool: ToolName): Set<string> {
  const def = tools()
    .defs()
    .find((d) => d.function.name === tool);
  const params = def?.function.parameters as { properties?: Record<string, unknown> } | undefined;
  return new Set(Object.keys(params?.properties ?? {}));
}

/** The wire parameters a tool actually puts on a request, across every declared-argument call. */
async function agentParams(tool: ToolName, calls: Record<string, unknown>[]): Promise<Set<string>> {
  const params = new Set<string>();
  for (const args of calls) {
    const result = await tools().dispatch(tool, JSON.stringify(args));
    expect(
      result.endpoints,
      `no request was made for ${JSON.stringify(args)} — the call was rejected, so this row ` +
        `checks nothing: ${result.content.slice(0, 200)}`,
    ).not.toEqual([]);
    for (const endpoint of result.endpoints) {
      const query = endpoint.split("?")[1];
      if (query === undefined) continue;
      for (const key of new URLSearchParams(query).keys()) params.add(key);
    }
  }
  return params;
}

/**
 * A site parameter the tool does not send, and the parameter that covers the same ground.
 * `source`/`destination` are the page's two menus, one per end of a crossing; Zcash sits at exactly
 * one end of every transfer, so the tool asks direction-blind with `chain`, the shape spoken
 * questions take. `days` is the flows tab's trailing window, where the tool takes absolute edges:
 * "how much crossed in July" has fixed edges, while "the last 41 days" answers a different question
 * every day.
 */
const EXPRESSED_BY: Record<string, { insteadOf: string; because: string }> = {
  source: {
    insteadOf: "chain",
    because:
      "one ticker matched at whichever end is not Zcash, which the two directional filters would AND to the empty set",
  },
  destination: {
    insteadOf: "chain",
    because: "the same, from the other side",
  },
  days: {
    insteadOf: "from",
    because: "an absolute window, so a question about a named period answers the same tomorrow",
  },
};

describe("every narrowing a reader can apply, the agent can apply", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends the value threshold the site's own filter chips send", async () => {
    const site = await siteParams();
    vi.unstubAllGlobals();
    const agent = await agentParams("crosschain", CROSSCHAIN_CALLS);

    // The site side is only evidence if it recorded something; a stubbed fetch that threw would
    // leave two empty sets comparing equal.
    expect(site.has("min"), "the site adapter no longer sends a value threshold").toBe(true);

    const unreachable = [...site].filter((p) => !agent.has(p) && EXPRESSED_BY[p] === undefined);
    expect(
      unreachable,
      `the site can narrow on [${unreachable.join(", ")}] and the crosschain tool cannot. ` +
        `Add the parameter, or declare which tool parameter covers it in EXPRESSED_BY.`,
    ).toEqual([]);
  });

  /**
   * An excuse must name a parameter that exists, or the table becomes a place to park a gap behind
   * a renamed parameter.
   */
  it("declares a covering parameter the tool really sends", async () => {
    const agent = await agentParams("crosschain", CROSSCHAIN_CALLS);
    for (const [param, { insteadOf }] of Object.entries(EXPRESSED_BY)) {
      expect(agent.has(insteadOf), `${param} claims to be covered by ${insteadOf}`).toBe(true);
    }
  });

  /**
   * This makes the check about the model rather than our dispatch code: every argument in the table
   * must be a property the model is shown.
   */
  it("exercises only arguments the schema declares, so reachability is the model's", () => {
    const declared = declaredProperties("crosschain");
    const undeclared = [...new Set(CROSSCHAIN_CALLS.flatMap((args) => Object.keys(args)))].filter(
      (key) => !declared.has(key),
    );
    expect(
      undeclared,
      `the dispatch table sends [${undeclared.join(", ")}], which no schema property declares — ` +
        `a model could never send them, so those rows prove nothing`,
    ).toEqual([]);
  });

  /** The inverse: a declared property with no row is a narrowing nothing here exercises. */
  it("exercises every narrowing the schema declares", () => {
    const used = new Set(CROSSCHAIN_CALLS.flatMap((args) => Object.keys(args)));
    const unexercised = [...declaredProperties("crosschain")].filter((p) => !used.has(p));
    expect(unexercised, `no dispatch row sets: ${unexercised.join(", ")}`).toEqual([]);
  });
});
