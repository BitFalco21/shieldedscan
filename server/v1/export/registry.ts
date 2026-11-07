import type { ExportSpec } from "./spec";
import { ADDRESS_EXPORT_PATTERN } from "./address-route";
import {
  FEES_SPEC,
  MONTHLY_SPEC,
  NETWORK_SPEC,
  POOLS_SPEC,
  POOL_USAGE_SPEC,
  TRANSPARENT_SPEC,
} from "./specs/series";
import { ACTIVITY_SPEC, MIGRATIONS_SPEC, MINERS_SPEC, SHIELDING_FLOW_SPEC } from "./specs/windowed";
import {
  ADDRESS_TRANSACTIONS_SPEC,
  BLOCKS_SPEC,
  BLOCK_TRANSACTIONS_SPEC,
  REORGS_SPEC,
  RICH_LIST_SPEC,
  TRANSACTIONS_SPEC,
} from "./specs/lists";
import { PRICES_SPEC, SUPPLY_SPEC } from "./specs/supply";

/**
 * Every `/v1` route that answers `format=csv|json`, keyed by the route pattern Hono matched (so
 * `:addr`, as `routes.ts` registers it). A test holds every key to a mounted route.
 *
 * This is also the contract phase 2 builds on: a series family maps to one of these paths plus
 * its parameters, and the file is that URL with `format` added.
 */
export const EXPORTS: Readonly<Record<string, ExportSpec>> = {
  "/v1/analytics/pools": POOLS_SPEC,
  "/v1/analytics/pool-usage": POOL_USAGE_SPEC,
  "/v1/analytics/network": NETWORK_SPEC,
  "/v1/analytics/fees": FEES_SPEC,
  "/v1/analytics/transparent": TRANSPARENT_SPEC,
  "/v1/analytics/monthly": MONTHLY_SPEC,
  "/v1/analytics/activity": ACTIVITY_SPEC,
  "/v1/analytics/shielding-flow": SHIELDING_FLOW_SPEC,
  "/v1/analytics/migrations": MIGRATIONS_SPEC,
  "/v1/analytics/miners": MINERS_SPEC,
  "/v1/supply": SUPPLY_SPEC,
  "/v1/prices/daily": PRICES_SPEC,
  "/v1/blocks": BLOCKS_SPEC,
  "/v1/blocks/:id/transactions": BLOCK_TRANSACTIONS_SPEC,
  "/v1/transactions": TRANSACTIONS_SPEC,
  "/v1/addresses/:addr/transactions": ADDRESS_TRANSACTIONS_SPEC,
  "/v1/rich-list": RICH_LIST_SPEC,
  "/v1/reorgs": REORGS_SPEC,
};

/**
 * Routes that read `format` themselves: the circulating supply's published `text | json`, and the
 * address export, which is a file whatever it is asked.
 */
export const SELF_FORMATTED: ReadonlySet<string> = new Set([
  "/v1/supply/circulating",
  ADDRESS_EXPORT_PATTERN,
]);
