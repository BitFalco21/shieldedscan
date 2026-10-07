import type { PoolName } from "@/domain";

/**
 * "This transaction used the pool", as SQL over `tx` — one definition for every query that asks.
 *
 * A pool is used when the transaction carried a bundle: for Sapling that means spends OR outputs
 * (a shielding transaction has outputs and no spends), and for Sprout it is `sprout_joinsplits`,
 * since Sprout's accounting predates the `..._actions` columns of later pools.
 *
 * Each string is also the predicate of that pool's partial index in `schema-chain.sql`
 * (`tx_pool_<pool>_keyset_idx`). The planner uses a partial index only when the query proves its
 * predicate, so a pool-filtered list seeks that index instead of walking `tx_keyset_idx`.
 *
 * A `Record<PoolName, …>`, so adding a pool fails to compile until it defines "used".
 */
export const POOL_USED_SQL: Readonly<Record<PoolName, string>> = {
  ironwood: "ironwood_actions > 0",
  orchard: "orchard_actions > 0",
  sapling: "(sapling_spends > 0 OR sapling_outputs > 0)",
  sprout: "sprout_joinsplits > 0",
};
