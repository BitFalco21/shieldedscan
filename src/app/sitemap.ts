import type { MetadataRoute } from "next";
import { isTestnet } from "@/lib/network";
import { siteUrl } from "@/lib/site";
import { isAgentEnabled } from "@/lib/agent";

/**
 * The site's own statement of what it publishes. Exported so the agent's page guide is keyed
 * off it: `site-guide.ts` describes every path here, and a test fails when one is added
 * without a description.
 */
export const STATIC_PATHS = [
  "/",
  "/blocks",
  "/txs",
  "/shielded",
  "/cross-chain",
  "/cross-chain/flows",
  "/cross-chain/protocols",
  "/mempool",
  "/reorgs",
  "/analytics",
  // `/mining` is deliberately absent: a page hidden from the nav is not listed for indexing.
  "/api-docs",
  // The MCP server's how-to, for AI assistants.
  "/mcp",
  "/charts",
  // The landing view only: `?vs=` selections would be near-identical documents.
  "/compare",
  "/compare/all",
  "/halving",
  "/satoshi",
  "/fact-check",
  "/mining-cost",
  "/stats",
  "/stats/shielded",
  "/pulse",
  // Each node-map tab is its own route. The nodes list is listed once: its filtered and paged
  // views are the same page asking a narrower question.
  "/network",
  "/network/map",
  "/network/software",
  "/network/upgrade",
  "/network/health",
  "/network/nodes",
  "/zips",
  "/ecosystem",
  // Page one only: 843k addresses at 50 a page is ~17,000 near-identical documents, and
  // offering a crawler all of them is index bloat rather than reach.
  "/rich-list",
  "/donate",
  "/learn",
  // The footer pages. `/privacy` and `/terms` are listed deliberately: an unindexed privacy
  // policy is one nobody can check.
  "/about",
  "/brand",
  "/privacy",
  "/terms",
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  // Testnet publishes no sitemap: robots.ts already disallows everything there, and a
  // sitemap listing pages crawlers are forbidden to visit is a contradiction that some
  // crawlers resolve in the sitemap's favour. This check comes first.
  if (isTestnet) return [];
  // `/ai-agent` is listed only where the flag enables it.
  const paths = isAgentEnabled ? [...STATIC_PATHS, "/ai-agent"] : [...STATIC_PATHS];
  return paths.map((path) => ({
    url: `${siteUrl}${path}`,
    changeFrequency: path === "/" ? "hourly" : "daily",
    priority: path === "/" ? 1 : 0.7,
  }));
}
