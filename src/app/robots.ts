import type { MetadataRoute } from "next";
import { isTestnet } from "@/lib/network";
import { isPublicStage, siteUrl } from "@/lib/site";

/**
 * While the site is a private preview, disallow everything — a leaked URL must not
 * put fixture data into a search index. Flipped by NEXT_PUBLIC_STAGE=public.
 *
 * The testnet deployment is never indexable, whatever the stage says: it runs with
 * NEXT_PUBLIC_STAGE=public on purpose (that flag also arms the fixture-refusal tripwire),
 * and indexed testnet figures would be indistinguishable from real ones in search results.
 *
 * `/social/` is disallowed even on mainnet: it is the social cards' render surface, public
 * so it can be screenshotted, but never a page a visitor arrives at.
 */
export default function robots(): MetadataRoute.Robots {
  if (!isPublicStage || isTestnet) {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }
  return {
    rules: [
      {
        userAgent: "*",
        // The site icons are allowed explicitly because `/*?` below would block them: Next
        // serves them as `/icon.png?icon.<hash>.png`, and Google's favicon service will not
        // fetch a disallowed icon. Google applies the longest matching rule, so these beat
        // `/*?` for those two paths only.
        allow: ["/", "/icon.png", "/apple-icon.png"],
        // Detail pages number in the millions and each costs a server render, while the static
        // pages carry every claim this site makes. `/*?` keeps crawlers off paginated and
        // filtered lists. Impolite crawlers meet `lib/crawl-guard.ts` at the edge.
        disallow: ["/social/", "/tx/", "/address/", "/block/", "/*?"],
        crawlDelay: 5,
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
