import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { SiteNav } from "@/components/SiteNav";
import { SiteFooter } from "@/components/SiteFooter";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";
import { CommandPalette } from "@/components/CommandPalette";
import { DismissPopovers } from "@/components/DismissPopovers";
import { TestnetBanner } from "@/components/TestnetBanner";
import { isTestnet } from "@/lib/network";
import { isPublicStage, siteUrl } from "@/lib/site";
import { siteShareImages, siteShareName, siteTwitterCard } from "@/lib/share-card";

/**
 * The terminal face. Self-hosted (CSP allows only `font-src 'self'`), one family
 * for every role — the design system is single-voice mono. Weights 400/700/800;
 * `font-semibold` (600) resolves to 700 by CSS font matching, which is intended.
 */
const jetbrainsMono = localFont({
  src: [
    { path: "../../public/fonts/JetBrainsMono-Regular.woff2", weight: "400", style: "normal" },
    { path: "../../public/fonts/JetBrainsMono-Bold.woff2", weight: "700", style: "normal" },
    { path: "../../public/fonts/JetBrainsMono-ExtraBold.woff2", weight: "800", style: "normal" },
  ],
  variable: "--font-jetbrains",
  display: "swap",
});

/**
 * The title names the network on testnet so a browser tab, a bookmark and a share card can
 * never present testnet as the real site — the metadata-level half of the banner's job.
 */
const siteTitle = isTestnet
  ? "shieldedscan — Zcash Testnet Explorer"
  : "shieldedscan — Zcash Block Explorer";
const siteDescription = isTestnet
  ? "Zcash TESTNET explorer — coins here have no value. The privacy-first mainnet explorer is at shieldedscan.xyz."
  : "Cypherpunk Zcash block explorer. Explore shielded pools, cross-chain flows and network analytics.";

export const metadata: Metadata = {
  title: {
    default: siteTitle,
    template: isTestnet ? "%s · shieldedscan testnet" : "%s · shieldedscan",
  },
  description: siteDescription,
  metadataBase: new URL(siteUrl),
  // No web app manifest, deliberately: an installable site makes Chrome list this origin in its
  // site-data dialog, which reads like a site that set a cookie. Nothing here is a PWA, and the
  // icons come from `icon.png` and the JSON-LD below.
  // The share image, site name and card kind live in `lib/share-card.ts`, because Next replaces
  // this object on any page that sets its own `openGraph` (see `pageShareMetadata`).
  openGraph: {
    type: "website",
    siteName: siteShareName,
    title: siteTitle,
    description: siteDescription,
    images: siteShareImages,
  },
  twitter: { card: siteTwitterCard },
  // Testnet is never indexable, whatever the stage. The same rule lives in robots.ts and the
  // X-Robots-Tag in next.config.ts, because each surface reaches a different consumer.
  robots: isPublicStage && !isTestnet ? undefined : { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // `suppressHydrationWarning` is scoped to this element's attributes: the head script below
    // stamps `data-theme` before React hydrates, so the attribute React sees differs from the
    // one it rendered. It does not reach the children.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Stamps the chosen colour theme before first paint, so a violet reader never sees a
            green flash. Under 400 bytes, try/catch'd, and it writes only a known theme id —
            see THEME_BOOT_SCRIPT. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className={`${jetbrainsMono.variable} flex min-h-screen flex-col antialiased`}>
        {/*
          Organization data, for the logo Google shows beside a brand. A favicon only feeds
          the small search-result icon; `logo` must be a raster of at least 112px, hence the
          512. The CSP permits it: `script-src` already allows Next's inline hydration payload.
        */}
        <script
          type="application/ld+json"
          // Serialised, then `<` escaped: `JSON.stringify` does not escape `<`, so a field
          // containing `</script>` would close the element. Every field is a build-time constant
          // today; the escape keeps this safe if a chain-derived field is ever added.
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Organization",
              name: isTestnet ? "shieldedscan testnet" : "shieldedscan",
              url: siteUrl,
              logo: `${siteUrl}/icon-512.png`,
              description: siteDescription,
            }).replace(/</g, "\\u003c"),
          }}
        />
        <a
          href="#main"
          className="panel sr-only px-4 py-2 text-sm focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-30"
        >
          Skip to content
        </a>
        <TestnetBanner />
        <SiteNav />
        <main id="main" className="mx-auto min-h-[60vh] w-full max-w-6xl flex-1 px-6 pb-16">
          {children}
        </main>
        <SiteFooter />
        <CommandPalette />
        {/* Closes `<details data-popover>` menus on an outside click or Escape. Pure
            enhancement: with no JavaScript they still open and still choose. */}
        <DismissPopovers />
      </body>
    </html>
  );
}
