/**
 * The agent's tool names: the one list the schema, the dispatcher and the input guard key on.
 */

export const TOOL_NAMES = [
  "lookup_transaction",
  "lookup_block",
  "lookup_address",
  "chain_status",
  "explorer_analytics",
  "explorer_insights",
  "zec_price_history",
  "wrapped_zec_pools",
  "crosschain",
  "chain_activity",
  "zcash_reference",
  "site_guide",
  "calculate",
  "zip_index",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];
