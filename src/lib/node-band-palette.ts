import { NODE_OTHER_KEY, NODE_UNKNOWN_NETWORK_KEY } from "@/domain";

/**
 * The colours of the node-history bands: named bands by their rank in the window, from the flow
 * palette, the fold of everything else in the neutral rest hue, and nodes with no network found in
 * faint ink. By rank, not by name: release lines and networks come and go, so no fixed table
 * could hold them; a band keeps its colour across the days of one chart.
 */
const NAMED = ["flow-1", "flow-2", "flow-3", "flow-4", "flow-5", "flow-6", "flow-7"] as const;

/** How many bands a node-history chart names before folding the rest. */
export const NODE_BAND_SLOTS = NAMED.length;

export function nodeBandClass(key: string, rank: number): string {
  if (key === NODE_OTHER_KEY) return "flow-rest";
  if (key === NODE_UNKNOWN_NETWORK_KEY) return "text-ink-faint";
  return NAMED[rank] ?? "flow-rest";
}
