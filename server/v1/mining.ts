import { Hono } from "hono";
import type { MiningTerms } from "@/domain";
import { Cached } from "../cached";
import "../pg-types";
import { buildMiningTerms, type MiningTermsDeps } from "../mining-terms-routes";
import { MAINNET_SITE_URL } from "@/lib/network";
import { rejectUnknown } from "./params";
import { routeGroupErrors, setCache } from "./http";
import { amount } from "./format";

/**
 * `/v1/network/mining`: the chain's mining terms at the tip — difficulty, the network's
 * solution rate, the miner's subsidy and the observed block interval — the same
 * `buildMiningTerms` `/mining-cost` reads, behind a 30-second memo, so a crowd costs the node
 * one read per block-ish.
 *
 * Equihash yields SOLUTIONS, not hashes: the rate is in Sol/s, and `basis` says whether the node
 * reported it (`getnetworksolps`) or it was estimated from difficulty — never relabelled.
 */
export const V1_MINING_PATH = "/v1/network/mining";

export function v1MiningRoutes(deps: MiningTermsDeps): Hono {
  const app = new Hono();
  const memo = new Cached<MiningTerms>(30_000);
  app.onError(routeGroupErrors("the node could not answer just now; retry shortly"));
  app.get(V1_MINING_PATH, async (c) => {
    rejectUnknown(c.req.query(), []);
    const t = await memo.get(() => buildMiningTerms(deps));
    setCache(c, "miningTerms");
    return c.json({
      source: { name: "ShieldedScan", url: `${MAINNET_SITE_URL}/mining-cost` },
      data: {
        readAtHeight: t.height,
        difficulty: t.difficulty,
        networkSolutionRate: { solPerSecond: t.networkSolps.value, basis: t.networkSolps.basis },
        minerSubsidy: amount(t.minerSubsidyZat),
        subsidyChangesAtHeight: t.subsidyChangesAtHeight,
        observedBlockIntervalSeconds: t.blockIntervalSeconds,
        priceUsd: t.priceUsd,
      },
      unknowns: t.priceUsd === null ? { "data.priceUsd": "unmeasured" } : {},
      notes: [
        "networkSolutionRate.basis is node when the node reported it (getnetworksolps over its trailing window) and estimated when derived from difficulty at the observed interval.",
        "minerSubsidy is the miner's share of the block subsidy only; fees are on top and funding streams are not included.",
      ],
      asOf: t.asOf,
    });
  });
  return app;
}
