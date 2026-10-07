import type { PoolName } from "@/domain/pool";
import type { PulseEnd } from "@/domain/pulse";
import { POOL_CLASSES } from "./pool-palette";

/**
 * Which colour each node takes on `/pulse`.
 *
 * Unlike the Sankey's `flowPaletteClass`, which draws only chains, this page shows the shielded
 * pools and counterpart chains together, so the two vocabularies must never share a colour: a
 * chain ribbon in a pool's colour would read as that pool. Type-only imports keep this free of
 * domain logic.
 */

/**
 * The five chains that carry observable ZEC volume, each on a slot no pool holds, hand-assigned
 * so the largest flows sit far apart on the wheel. Adding a pool means removing its slot from
 * {@link CHAIN_SLOTS} as well; `pulse-palette.test.ts` checks both.
 */
const CHAIN_CLASSES: Readonly<Record<string, string>> = {
  ETH: "flow-5",
  SOL: "flow-3",
  BTC: "flow-8",
  TRON: "flow-7",
  NEAR: "flow-6",
};

/** Every slot the pools do not hold. A chain may only ever be drawn in one of these. */
const CHAIN_SLOTS = [3, 5, 6, 7, 8];

/**
 * The folded tail of a ribbon list. Not `flow-rest` (the Sankey's tail colour), which is
 * Sprout's on this page.
 */
export const PULSE_FOLDED_CLASS = "text-ink-faint";

/**
 * The ledger, the lockbox, issuance and the boundary hub: places, not categories, so they take
 * neutral ink rather than a slot colour.
 */
export const PULSE_PLACE_CLASS = "text-ink-dim";

/** The pools keep the site's own colours (`pool-palette.ts`), so a pool reads the same here. */
export function pulsePoolClass(pool: PoolName): string {
  return POOL_CLASSES[pool];
}

const normalise = (chain: string): string => chain.trim().toUpperCase();

/**
 * The slot every chain in one frame takes, assigned from the frame's own tickers so no two
 * chains on screen share a colour (a hash of each ticker could not guarantee that). The five
 * named chains keep fixed slots so their colours are stable across visits; the rest take the
 * remaining slots in sorted order. Past the last free slot, overflow takes the folded tail's
 * neutral ink, never a pool colour.
 */
export function pulseChainClasses(tickers: readonly string[]): ReadonlyMap<string, string> {
  const wanted = [...new Set(tickers.map(normalise))];
  const classes = new Map<string, string>();
  const taken = new Set<number>();
  for (const ticker of wanted) {
    if (ticker === "UNKNOWN") {
      classes.set(ticker, PULSE_FOLDED_CLASS);
      continue;
    }
    const named = CHAIN_CLASSES[ticker];
    if (named === undefined) continue;
    classes.set(ticker, named);
    taken.add(Number(named.slice("flow-".length)));
  }
  const free = CHAIN_SLOTS.filter((slot) => !taken.has(slot));
  const rest = wanted.filter((t) => !classes.has(t)).sort((a, b) => a.localeCompare(b));
  rest.forEach((ticker, i) => {
    const slot = free[i];
    classes.set(ticker, slot === undefined ? PULSE_FOLDED_CLASS : `flow-${slot}`);
  });
  return classes;
}

/**
 * The colour any end of a movement is drawn in, within one frame. The map is required so no
 * caller can skip {@link pulseChainClasses}. A ticker absent from it was folded, so it takes the
 * fold's neutral ink.
 */
export function pulseNodeClass(node: PulseEnd, chainClasses: ReadonlyMap<string, string>): string {
  if (node.startsWith("chain:")) {
    const ticker = normalise(node.slice("chain:".length));
    return chainClasses.get(ticker) ?? PULSE_FOLDED_CLASS;
  }
  switch (node) {
    case "ironwood":
    case "orchard":
    case "sapling":
    case "sprout":
      return pulsePoolClass(node);
    default:
      return PULSE_PLACE_CLASS;
  }
}
