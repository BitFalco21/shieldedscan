import Link from "@/components/Link";
import { NetworkSwitchLink } from "@/components/NetworkSwitchLink";
import { ZakuraMark } from "@/components/ZakuraMark";
import { X_PROJECT_URL, ZAKURA_URL } from "@/lib/links";
import { isTestnet, siblingNetworkName } from "@/lib/network";

/**
 * No donate on testnet: TAZ is worthless and the address is a mainnet one. The route itself
 * 404s on testnet too (`app/donate/page.tsx`).
 */
const FOOTER_PAGES: ReadonlyArray<readonly [href: string, label: string]> = [
  // First, because it is the one a newcomer is looking for. Mainnet-only: it teaches buying and
  // moving real ZEC, and the route 404s on testnet (`app/learn/page.tsx`).
  ...(isTestnet ? [] : ([["/learn", "learn"]] as const)),
  ["/about", "about"],
  ["/brand", "brand"],
  ...(isTestnet ? [] : ([["/donate", "donate"]] as const)),
  ["/privacy", "privacy"],
  ["/terms", "terms"],
];

/**
 * The footer: brand, tagline, the site's own secondary pages, and two credits.
 *
 * The footer does not restate the nav. Everything here is a destination the nav deliberately
 * does not carry: pages a visitor looks for once, when they want to know who runs this and
 * what it does with their data.
 *
 * Terminal grammar for this site's own pages (`> about`), plain links for off-site ones — a
 * shell command that opens someone else's website would misdescribe the control. Every
 * external link opens in a new tab and carries `noopener noreferrer`.
 */
export function SiteFooter() {
  /* `bg-bg/90`: a near-opaque bed in the page colour. Invisible on pages whose ground is
     already --bg; on the homepage the fixed photograph scrolls under this text, and its
     grade is anchored to the viewport, so the footer would otherwise sit over the brightest
     part of the image. */
  return (
    <footer className="border-t border-edge-faint bg-bg/90">
      <div className="mx-auto w-full max-w-6xl px-6 py-10">
        <div className="text-[15px] font-bold text-green">./shieldedscan</div>
        <p className="mt-3 max-w-md text-sm text-ink-dim">
          A privacy-first Zcash block explorer. Shielded activity is a first-class citizen, never an
          empty cell.
        </p>

        <nav aria-label="Footer" className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          {FOOTER_PAGES.map(([href, label]) => (
            <Link key={href} href={href} className="text-ink-dim hover:text-green">
              <span aria-hidden>&gt; </span>
              {label}
            </Link>
          ))}
          {/* The network toggle: terminal grammar, because the sibling deployment is this same
              site pointed at the other chain. It preserves the current path where the sibling
              has the route. */}
          <NetworkSwitchLink className="text-ink-dim hover:text-green">
            <span aria-hidden>&gt; </span>
            {siblingNetworkName}
          </NetworkSwitchLink>
          <a
            href={X_PROJECT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-ink-dim hover:text-green"
          >
            X ↗
          </a>
        </nav>

        {/* The credit sits apart from the navigation: an acknowledgement, not a destination.
            Zakura is the Zcash full node every figure here is read from. The mark is inlined
            rather than hotlinked: the CSP forbids a third-party image, and one per page view
            would be a tracking vector. */}
        <p className="mt-6 flex items-center gap-2 text-xs text-ink-faint">
          <span>Powered by</span>
          <a
            href={ZAKURA_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-ink-dim hover:text-green"
          >
            <ZakuraMark size={16} />
            <span>Zakura</span>
          </a>
        </p>
      </div>
    </footer>
  );
}
