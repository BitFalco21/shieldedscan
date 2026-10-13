import { beforeAll, describe, expect, it } from "vitest";
import { API_GROUPS } from "@/api-catalogue";
import { AgentTools, TOOL_NAMES, type ChainRequester, type ToolName } from "../tools";
import { makeChain, makeV1, FIXTURE_NOW_MS } from "../testing/fixture-world";

/**
 * Every endpoint an MCP client can call, Zeno can reach — or the table says why not.
 *
 * MCP tools are generated from the `/api-docs` catalogue, so a published endpoint becomes an MCP
 * tool automatically, while Zeno's tools are hand-built. This table makes a new endpoint fail the
 * build until someone names the Zeno tool that reaches it.
 *
 * A row names a tool and, where it has one, the facet, mode, topic or series value that dispatches
 * it; that value is checked against the tool's own schema, so a renamed facet fails here too. Some
 * endpoints are reached through a private twin, because aggregates route through `/chain/*`; the
 * row still names the tool that answers the same question. An endpoint deliberately left out says
 * why in `unreached`.
 */
type Reach = { tool: ToolName; via?: string } | { unreached: string };

const REACHED_BY: Readonly<Record<string, Reach>> = {
  "chain-info": { tool: "chain_status", via: "chain" },
  blocks: { tool: "chain_activity", via: "recent-blocks" },
  "block-detail": { tool: "lookup_block" },
  "block-transactions": { tool: "lookup_block" },
  transactions: { tool: "chain_activity", via: "recent-transactions" },
  "transaction-detail": { tool: "lookup_transaction" },
  address: { tool: "lookup_address" },
  "address-transactions": { tool: "lookup_address" },
  "address-activity": { tool: "lookup_address" },
  "address-extremes": { tool: "lookup_address" },
  // The search classifier routes an identifier to its lookup; there is nothing else to search.
  search: { tool: "lookup_transaction" },
  "rich-list": { tool: "explorer_insights", via: "holder-distribution" },
  "rich-list-distribution": { tool: "explorer_insights", via: "holder-distribution" },
  // The same names, sources, balances and ranks, read from the private route beside the label table.
  labels: { tool: "site_guide", via: "labels" },
  descriptor: { tool: "site_guide", via: "api" },
  status: { tool: "chain_status", via: "status" },
  // The same committed corpus, served from the same module.
  reference: { tool: "zcash_reference" },
  supply: { tool: "chain_status", via: "supply" },
  circulating: { tool: "chain_status", via: "supply" },
  fees: { tool: "chain_status", via: "fees" },
  prices: { tool: "zec_price_history" },
  halving: { tool: "chain_status", via: "halving" },
  mining: { tool: "chain_status", via: "mining" },
  "nodes-summary": { tool: "chain_status", via: "nodes" },
  "nodes-list": {
    unreached:
      "per-node rows are for browsing /network/nodes; every question about the network is a count the 'nodes' facet carries",
  },
  "nodes-geography": { tool: "chain_status", via: "nodes" },
  "nodes-concentration": { tool: "chain_status", via: "nodes" },
  "tx-privacy": { tool: "lookup_transaction" },
  transfers: { tool: "crosschain", via: "transfers" },
  "transfers-top": { tool: "crosschain", via: "transfers" },
  transfer: {
    unreached:
      "a transfer id is the venue's own key, which no reader asks by; lookup_transaction covers its Zcash leg",
  },
  "crosschain-aggregate": { tool: "crosschain", via: "aggregate" },
  flows: { tool: "explorer_analytics", via: "crosschain-flows" },
  destinations: { tool: "crosschain", via: "destinations" },
  "reorgs-list": { tool: "chain_status", via: "reorgs" },
  "reorgs-summary": { tool: "chain_status", via: "reorgs" },
  "mempool-summary": { tool: "explorer_analytics", via: "mempool" },
  monthly: { tool: "explorer_analytics", via: "monthly" },
  activity: { tool: "chain_activity", via: "window" },
  "shielding-flow": { tool: "explorer_insights", via: "shielding-flow" },
  migrations: { tool: "chain_activity", via: "window" },
  "analytics-pools": { tool: "chain_activity", via: "pool-balances" },
  "analytics-pool-usage": { tool: "chain_activity", via: "pools" },
  "analytics-transparent": { tool: "chain_activity", via: "transparent" },
  // Block-weighted difficulty and block size per period are 'window' measures.
  "analytics-network": { tool: "chain_activity", via: "window" },
  "analytics-miners": { tool: "chain_activity", via: "miners" },
  "analytics-fees": { tool: "explorer_insights", via: "transaction-costs" },
  "analytics-ironwood": { tool: "explorer_insights", via: "ironwood-inflow" },
  "analytics-records": { tool: "chain_status", via: "records" },
};

/** Every string `enum` anywhere in a JSON schema. */
function enumValues(schema: unknown): string[] {
  if (Array.isArray(schema)) return schema.flatMap(enumValues);
  if (typeof schema !== "object" || schema === null) return [];
  return Object.entries(schema as Record<string, unknown>).flatMap(([key, value]) =>
    key === "enum" && Array.isArray(value)
      ? value.filter((v): v is string => typeof v === "string")
      : enumValues(value),
  );
}

describe("every published endpoint is reachable by Zeno, or says why not", () => {
  const endpoints = API_GROUPS.flatMap((g) => g.endpoints);
  const defs = new Map(
    new AgentTools(makeV1(), makeChain(), () => FIXTURE_NOW_MS)
      .defs()
      .map((d) => [d.function.name, d.function.parameters]),
  );

  it("maps every endpoint in the /api-docs catalogue, and nothing that is not in it", () => {
    const ids = endpoints.map((e) => e.id);
    expect(ids.filter((id) => !(id in REACHED_BY))).toEqual([]);
    expect(Object.keys(REACHED_BY).filter((id) => !ids.includes(id))).toEqual([]);
  });

  it("names tools and dispatch values that exist", () => {
    const broken: string[] = [];
    for (const [id, reach] of Object.entries(REACHED_BY)) {
      if ("unreached" in reach) continue;
      if (!(TOOL_NAMES as readonly string[]).includes(reach.tool)) {
        broken.push(`${id}: no tool ${reach.tool}`);
      } else if (reach.via !== undefined && !enumValues(defs.get(reach.tool)).includes(reach.via)) {
        broken.push(`${id}: ${reach.tool} has no '${reach.via}'`);
      }
    }
    expect(broken).toEqual([]);
  });

  it("keeps deliberate exclusions rare and explained", () => {
    const unreached = Object.values(REACHED_BY).filter((r) => "unreached" in r);
    expect(unreached.length).toBeLessThanOrEqual(2);
    for (const r of unreached)
      expect(("unreached" in r ? r.unreached : "").length).toBeGreaterThan(40);
  });
});

/**
 * The other direction: every route Zeno reads off the private surface, which an MCP client cannot
 * call. Each is found by dispatching every tool with every value its schema offers and recording
 * what reaches the chain requester, so a new private read fails the build until this table says
 * whether MCP users get the same answer, and if not, why.
 *
 * `twin` names the /api-docs endpoint that serves the same figures; `lacks` says what that twin
 * does not serve yet. `unpublished` is a read with no public twin, and why it has none. Paths are
 * the route patterns, with the sampled address shown as `:address` and the query dropped.
 */
type PrivateRead = { twin: string; lacks?: string } | { unpublished: string };

const PRIVATE_READS: Readonly<Record<string, PrivateRead>> = {
  "/chain/addresses/:address/activity": {
    twin: "address-activity",
    lacks:
      "the `applied` echo verifyWindowEcho checks, and `complete` as a field rather than a note",
  },
  "/chain/addresses/:address/value-extremes": {
    twin: "address-extremes",
    lacks:
      "`complete` and `fromHeight` as fields; the public payload states them in a coverage note",
  },
  "/chain/rich-list/summary": {
    twin: "rich-list-distribution",
    lacks:
      "the top addresses with the names this site prints beside them; /v1 gives names only through /v1/labels",
  },
  "/chain/rich-list": {
    twin: "rich-list",
    lacks: "`fromRank`: the public list pages by cursor only, so rank 500 is many reads away",
  },
  "/crosschain/volume-series": {
    twin: "crosschain-aggregate",
    lacks:
      "both grains in one read, with no window. The figures differ too: this route counts pending transfers, the twin completed ones only",
  },
  "/chain/analytics/window": {
    twin: "activity",
    lacks:
      "open-ended windows, ranking by ZEC shielded or unshielded, block size or difficulty, `daysCovered`, and the migration matrix in the same read",
  },
  "/chain/analytics/ironwood": {
    twin: "analytics-ironwood",
    lacks: "the hourly balance series and the rolling 24h, 7d and 30d migration totals",
  },
  "/chain/analytics/fee-kinds": {
    twin: "analytics-fees",
    lacks: "fees by transaction kind in one read, and the record fees valued at that day's close",
  },
  "/chain/analytics/shielding-flow-days": {
    unpublished:
      "each transaction's net movement in or out of the shielded pools, a different quantity from the per-pool boundary legs /v1/analytics/shielding-flow serves",
  },
  "/chain/analytics/tx-counts": {
    unpublished:
      "all-time counts per transaction kind, coinbase included; /v1/analytics/activity counts a window and leaves coinbase out",
  },
  "/chain/zips": {
    unpublished:
      "an index of ZIP headers whose canonical machine-readable source is github.com/zcash/zips itself",
  },
  "/chain/market/assets": {
    unpublished: "CoinGecko's market figures for other assets, which are not ours to republish",
  },
  "/chain/defillama/zec-pools": {
    unpublished:
      "DefiLlama's figures for wrapped-ZEC pools on other chains, read from someone else's free tier",
  },
};

/** A value for each required parameter that has no enum, by name. */
const SAMPLE_ARGS: Readonly<Record<string, unknown>> = {
  txid: "a".repeat(64),
  heightOrHash: "3000000",
  address: "t1RankFiveHundredFixtureAddress00001",
  expressions: ["1 + 1"],
};

/** Tools whose schema requires one of two parameters, which the schema cannot say. */
const BASE_ARGS: Partial<Record<ToolName, Record<string, unknown>>> = {
  zec_price_history: { days: 30 },
};

interface ToolSchema {
  properties?: Record<string, { type?: string; enum?: string[]; items?: { enum?: string[] } }>;
  required?: string[];
}

/**
 * Every argument set worth dispatching for one tool: each value of each required enum, then each
 * optional enum value, each flag and a two-sided window on top of it. A combination the tool
 * refuses is skipped, and the coverage test below catches a required value that never dispatched.
 */
function argumentSets(tool: ToolName, schema: ToolSchema): Record<string, unknown>[] {
  const props = Object.entries(schema.properties ?? {});
  const enumOf = (p: (typeof props)[number][1]) => p.enum ?? p.items?.enum;
  const as = (p: (typeof props)[number][1], v: string) => (p.type === "array" ? [v] : v);
  let bases: Record<string, unknown>[] = [{ ...BASE_ARGS[tool] }];
  for (const [name, p] of props) {
    if (!(schema.required ?? []).includes(name)) continue;
    const values = enumOf(p);
    bases = values
      ? bases.flatMap((b) => values.map((v) => ({ ...b, [name]: as(p, v) })))
      : bases.map((b) => ({ ...b, [name]: SAMPLE_ARGS[name] }));
  }
  const optional = props.filter(([name]) => !(schema.required ?? []).includes(name));
  return bases.flatMap((base) => {
    const sets = [base];
    for (const [name, p] of optional) {
      for (const v of enumOf(p) ?? []) sets.push({ ...base, [name]: as(p, v) });
      if (p.type === "boolean") sets.push({ ...base, [name]: true });
    }
    return sets.flatMap((s) => [s, { ...s, from: "2026-01-01", to: "2026-02-01" }]);
  });
}

describe("every private route Zeno reads is published, or says why not", () => {
  const reads = new Set<string>();
  const accepted: { tool: string; args: Record<string, unknown> }[] = [];

  function recordingChain(): ChainRequester {
    const chain = makeChain();
    return {
      request: (path) => {
        reads.add(path.replace(/\?.*$/, "").replace(String(SAMPLE_ARGS.address), ":address"));
        return chain.request(path);
      },
    };
  }
  const tools = new AgentTools(makeV1(), recordingChain(), () => FIXTURE_NOW_MS);

  beforeAll(async () => {
    for (const def of tools.defs()) {
      const tool = def.function.name as ToolName;
      for (const args of argumentSets(tool, def.function.parameters as ToolSchema)) {
        const result = await tools.dispatch(tool, JSON.stringify(args));
        if (!result.content.startsWith("invalid arguments")) accepted.push({ tool, args });
      }
    }
  });

  it("dispatches every tool, and every value of each required enum, at least once", () => {
    const missed: string[] = [];
    for (const def of tools.defs()) {
      const schema = def.function.parameters as ToolSchema;
      const runs = accepted.filter((a) => a.tool === def.function.name);
      if (runs.length === 0) missed.push(def.function.name);
      for (const name of schema.required ?? []) {
        const p = schema.properties?.[name];
        for (const v of p?.enum ?? p?.items?.enum ?? []) {
          if (!runs.some((r) => [r.args[name]].flat().includes(v)))
            missed.push(`${def.function.name} ${name}=${v}`);
        }
      }
    }
    expect(missed).toEqual([]);
  });

  it("lists every private route a tool reads, and nothing it no longer reads", () => {
    const routes = [...reads].sort();
    expect(routes.filter((r) => !(r in PRIVATE_READS))).toEqual([]);
    expect(Object.keys(PRIVATE_READS).filter((r) => !routes.includes(r))).toEqual([]);
  });

  it("names twins that are in the catalogue, and explains every gap", () => {
    const ids = API_GROUPS.flatMap((g) => g.endpoints).map((e) => e.id);
    const broken: string[] = [];
    for (const [route, read] of Object.entries(PRIVATE_READS)) {
      if ("twin" in read && !ids.includes(read.twin))
        broken.push(`${route}: no endpoint ${read.twin}`);
      const why = "unpublished" in read ? read.unpublished : read.lacks;
      if (why !== undefined && why.length < 40) broken.push(`${route}: explain why`);
    }
    expect(broken).toEqual([]);
  });
});
