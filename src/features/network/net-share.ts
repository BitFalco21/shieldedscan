import { pageShareMetadata } from "@/lib/share-card";

/**
 * What a shared `/network` link previews as on X, Slack or Discord. The site card image is kept
 * (see `lib/share-card.ts`); only the words change, so a preview names the node map instead of
 * the explorer in general. No window length here: the page states the one the API used.
 */
const NETWORK_SHARE_DESCRIPTION =
  "Every Zcash node our own crawler can reach: where it runs, what software it runs, who hosts it, and who told us about whom. No addresses.";

export function networkShareMetadata(tab: string) {
  return pageShareMetadata(`Zcash network — ${tab} · shieldedscan`, NETWORK_SHARE_DESCRIPTION);
}
