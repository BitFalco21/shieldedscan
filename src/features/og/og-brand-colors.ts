/**
 * Brand colours as literal hex, for the one renderer that cannot read `.brand-*` classes.
 *
 * `globals.css` is the source of truth for every brand mark's colour. The compare share card is
 * rendered by satori, where there is no stylesheet, so colours arrive as values here, keyed by
 * the canonical mark key `canonicalMarkTicker` returns (the `.brand-<key>` suffix).
 *
 * `og-brand-colors.test.ts` asserts every entry matches its CSS rule. An asset whose key is not
 * here is drawn as a lettermark, never as its silhouette in a guessed colour: an inaccurate logo
 * is worse than an honest initial.
 *
 * The set is the fixture market's assets plus Zcash. Add a key when an asset above Zcash
 * renders a lettermark on its card.
 */
export const OG_BRAND_COLORS: Readonly<Record<string, string>> = {
  zec: "#f3b724",
  btc: "#f7931a",
  eth: "#7a7a7a",
  bsc: "#f0b90b",
  xrp: "#25a768",
  sol: "#9945ff",
  tron: "#ff060a",
  hype: "#97fce4",
  doge: "#c2a633",
  rain: "#dbf300",
  leo: "#dbaa4b",
};
