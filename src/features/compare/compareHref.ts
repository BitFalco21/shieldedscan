import { DEFAULT_VS_ASSET_ID } from "@/domain";

/**
 * The one place a `/compare` URL is built.
 *
 * A link's shape is a contract with the cache and with bookmarks, so it is built in one place.
 * The default asset carries no parameter, so the landing view keeps one URL and one CDN cache
 * key rather than two addresses for one page.
 */
export function compareHref(assetId: string): string {
  return assetId === DEFAULT_VS_ASSET_ID
    ? "/compare"
    : `/compare?vs=${encodeURIComponent(assetId)}`;
}

/**
 * The card image for one comparison. Every asset carries `?vs=`, including the default one:
 * the page's own URL keeps a single cache key by omitting it, but an image URL is fetched by
 * scrapers rather than by readers, and one shape for every asset keeps the route's cache
 * key (`Netlify-Vary: query=vs`) simple to reason about.
 */
export function compareCardHref(assetId: string): string {
  return `/compare/card?vs=${encodeURIComponent(assetId)}`;
}
