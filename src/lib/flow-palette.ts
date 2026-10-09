/**
 * Which of the flow palette's colours a chain takes in the cross-chain Sankey.
 *
 * Categorical, not brand: brand colours give ribbons uneven weight (Ethereum's is a dark grey),
 * while telling ribbons apart wants even spacing around the wheel. Deterministic per chain, so
 * a chain keeps its colour across both halves of the diagram and between visits. Unlisted
 * chains hash into the same palette, since venues add chains without warning.
 */
const PALETTE_SIZE = 8;

/**
 * Ordered roughly by observed volume, so the largest flows land on different palette entries.
 * A wrong order costs only two similar-sized chains sharing a hue.
 *
 * Exported for `pulse-palette.test.ts`, which proves no chain here can take a shielded pool's
 * colour. Runtime code does not read it.
 */
export const KNOWN = [
  "ETH",
  "SOL",
  "BTC",
  "TRON",
  "NEAR",
  "ARB",
  "MAYA",
  "BASE",
  "SUI",
  "LTC",
  "XRP",
  "DOGE",
  "DASH",
  "BCH",
  "CARDANO",
  "APTOS",
  "GNOSIS",
  "STARKNET",
  "POL",
  "AVAX",
  "BSC",
  "TON",
  "STELLAR",
];

/**
 * Stable small hash, so an unlisted chain gets a fixed colour rather than a random one.
 * Shared with `pulse-palette.ts` so a chain is placed the same way on every page.
 */
export function chainHash(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) {
    h = (h * 31 + text.charCodeAt(i)) % 100_003;
  }
  return h;
}

/** The folded tail's class: not a chain, so it takes the palette's neutral rather than a hue. */
export const FOLDED_FLOW_CLASS = "flow-rest";

export function flowPaletteClass(chain: string): string {
  const ticker = chain.toUpperCase();
  // The folded tail is not a chain and should not look like one.
  if (ticker === "UNKNOWN") return FOLDED_FLOW_CLASS;
  const known = KNOWN.indexOf(ticker);
  const index = known >= 0 ? known : chainHash(ticker);
  return `flow-${(index % PALETTE_SIZE) + 1}`;
}
