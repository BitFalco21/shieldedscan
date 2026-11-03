import type { PoolName } from "@/domain/pool";

/**
 * The colour class each shielded pool is drawn in, wherever a pool is a series or a node: one
 * table, so a pool reads the same on `/pulse`, `/analytics` and every chart. A `Record` over
 * `PoolName`, so a new pool fails to compile until it has a colour.
 */
export const POOL_CLASSES: Readonly<Record<PoolName, string>> = {
  ironwood: "flow-1",
  orchard: "flow-4",
  sapling: "flow-2",
  sprout: "flow-rest",
};

/**
 * A line drawn beside the pools that is not one of them, such as the shielded total. Magenta is
 * the flow colour apart from all four pools under every theme; the accent is not, since the amber
 * theme puts it on Ironwood's gold.
 */
export const BESIDE_POOLS = "flow-3";
