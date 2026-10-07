import type { MiningTerms } from "@/domain";
import { chainInfo } from "./chain";
import { TIP_HEIGHT, TIP_TIME } from "./ids";

/**
 * The chain-side terms for `/mining-cost`, for the fixture build.
 *
 * Real figures from the node, kept exact: the solution rate is `getnetworksolps` at height
 * 3,472,984 and the difficulty is that tip's header. The price is the fixture chain's
 * deliberately implausible $38.42, so the break-even tariff on a preview build is visibly a
 * fixture figure.
 */
export function getMiningTerms(): MiningTerms {
  return {
    height: TIP_HEIGHT,
    difficulty: 216_327_100.7843388,
    networkSolps: { value: 23_005_253_630, basis: "node" },
    minerSubsidyZat: 125_000_000,
    subsidyChangesAtHeight: 4_406_400,
    blockIntervalSeconds: 75.35,
    priceUsd: chainInfo.priceUsd,
    asOf: TIP_TIME,
  };
}
