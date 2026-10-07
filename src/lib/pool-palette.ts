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
