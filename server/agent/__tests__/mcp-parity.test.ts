import { describe, expect, it } from "vitest";
import { API_GROUPS } from "@/api-catalogue";
import { AgentTools, TOOL_NAMES, type ToolName } from "../tools";
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
