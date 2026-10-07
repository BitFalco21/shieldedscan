import { Hono } from "hono";
import type { Pool } from "pg";
import type { MiningTerms } from "@/domain";
import { BLOCK_TARGET_SECONDS, estimatedNetworkSolps, nextHalvingHeight } from "@/domain";
import { observedBlockIntervalSeconds } from "./network-routes";
import { Cached } from "./cached";
import type { PriceTracker } from "./chain-stats";

/**
 * `GET /chain/mining/terms` — the chain-side terms behind `/mining-cost`, read at one tip.
 *
 * A separate route rather than fields on `/chain/stats`, which the live layer polls every few
 * seconds; these terms change once a block. And not a new `ChainInfo` field, because that type is
 * spread into a fixture fallback and a new required field there would break frontend builds.
 *
 * The solution rate is the node's own `getnetworksolps` where it answers, and a labelled estimate
 * from difficulty where it does not. The basis travels in the payload.
 */

export const MINING_TERMS_PATH = "/chain/mining/terms";

/** Short (a new block every 75 s moves every term) and shared by every reader. */
const CACHE_MS = 30_000;

export interface MiningTermsChainSource {
  getChainFacts(): Promise<{ height: number; bestBlockHash: string }>;
  getDifficultyByHash(hash: string): Promise<number>;
  getNetworkSolps(): Promise<number | null>;
  getBlockSubsidy(height: number): Promise<{ miner: number }>;
}

export interface MiningTermsDeps {
  chain: MiningTermsChainSource;
  /** Absent on a deployment with no index: the interval then falls back to the 75 s target. */
  pool: Pool | null;
  /** Absent on testnet, where TAZ has no price; the page is absent there too. */
  price: Pick<PriceTracker, "current"> | null;
}

export async function buildMiningTerms(
  deps: MiningTermsDeps,
  now = Date.now(),
): Promise<MiningTerms> {
  const { height, bestBlockHash } = await deps.chain.getChainFacts();
  const [difficulty, nodeSolps, subsidy, interval] = await Promise.all([
    deps.chain.getDifficultyByHash(bestBlockHash),
    deps.chain.getNetworkSolps(),
    deps.chain.getBlockSubsidy(height),
    deps.pool ? observedBlockIntervalSeconds(deps.pool) : Promise.resolve(0),
  ]);
  const blockIntervalSeconds = interval > 0 ? interval : BLOCK_TARGET_SECONDS;
  const estimate = estimatedNetworkSolps(difficulty, blockIntervalSeconds);
  const networkSolps: MiningTerms["networkSolps"] | null =
    nodeSolps !== null && nodeSolps > 0
      ? { value: nodeSolps, basis: "node" }
      : estimate !== null
        ? { value: estimate, basis: "estimated" }
        : null;
  if (networkSolps === null)
    throw new Error(
      "no network solution rate: node answered nothing and difficulty was degenerate",
    );
  return {
    height,
    difficulty,
    networkSolps,
    // The node reports ZEC; the domain speaks zatoshi. Rounded because the node's floats are
    // exact multiples of 1e-8 and this only undoes representation.
    minerSubsidyZat: Math.round(subsidy.miner * 100_000_000),
    subsidyChangesAtHeight: nextHalvingHeight(height),
    blockIntervalSeconds,
    priceUsd: deps.price?.current(now)?.usd ?? null,
    asOf: Math.floor(now / 1000),
  };
}

export function miningTermsRoutes(deps: MiningTermsDeps): Hono {
  const app = new Hono();
  const terms = new Cached<MiningTerms>(CACHE_MS);
  app.get(MINING_TERMS_PATH, async (c) => c.json(await terms.get(() => buildMiningTerms(deps))));
  return app;
}
