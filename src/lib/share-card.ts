import type { Metadata } from "next";
import { isTestnet } from "./network";

/**
 * The link-preview image every page shares, defined once.
 *
 * Next.js replaces a parent segment's `openGraph` with a page's own rather than merging, so a
 * page setting only a title and description would drop the image. Any page with its own
 * preview text goes through `pageShareMetadata`, which always carries it.
 *
 * Mainnet: the 1200x630 card from `node brand/generate.mjs`. Testnet keeps the avatar under a
 * `summary` card, because the big card names shieldedscan.xyz in its own pixels and would state
 * the wrong site beside a testnet URL.
 */
export const siteShareImages: NonNullable<Metadata["openGraph"]>["images"] = isTestnet
  ? [{ url: "/icon-512.png", width: 512, height: 512, alt: "shieldedscan testnet" }]
  : [{ url: "/og.png", width: 1200, height: 630, alt: "./shieldedscan — PRIVACY IS NORMAL" }];

export const siteShareName = isTestnet ? "shieldedscan testnet" : "shieldedscan";

export const siteTwitterCard = isTestnet ? "summary" : "summary_large_image";

/** A page's own preview title and description, with the site's image and card kept. */
export function pageShareMetadata(
  title: string,
  description: string,
): Pick<Metadata, "openGraph" | "twitter"> {
  return {
    openGraph: {
      type: "website",
      siteName: siteShareName,
      title,
      description,
      images: siteShareImages,
    },
    twitter: { card: siteTwitterCard, title, description },
  };
}
