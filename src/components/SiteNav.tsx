import Link from "@/components/Link";
import { NavDonate } from "@/components/NavDonate";
import { NavMenu } from "@/components/NavMenu";
import { NavLinks } from "@/components/NavLinks";
import { NetworkSwitch } from "@/components/NetworkSwitch";
import { ThemeSwitch } from "@/components/ThemeSwitch";
import { isTestnet } from "@/lib/network";

export function SiteNav() {
  /* `bg-bg/60`: a faint scrim, a no-op on pages whose ground is already --bg. On the
     homepage the nav's small text sits over the busiest pixels of the photograph. */
  return (
    <nav className="relative border-b border-edge-faint bg-bg/60">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-4">
        <Link
          href="/"
          className="flex items-baseline gap-0.5 text-[15px] font-bold whitespace-nowrap text-green"
        >
          ./shieldedscan
          <span aria-hidden className="cursor-block logo-cursor" />
        </Link>
        <div className="flex items-center gap-5">
          <NavLinks />
          {/*
            Opens the ⌘K command palette (CommandPalette listens for clicks on
            [data-command-palette-trigger]) rather than submitting a form
            directly — this stays a static button so SiteNav can remain a
            Server Component. The <noscript> form below is the no-JS fallback,
            since a button with no onClick does nothing without CommandPalette's
            script running.
          */}
          <button
            type="button"
            data-command-palette-trigger
            aria-label="Search the chain"
            className="panel hidden cursor-pointer items-center gap-2 px-3 py-1.5 text-xs text-ink-dim sm:flex"
          >
            <span aria-hidden className="text-green">
              zcash&gt;
            </span>
            <span className="text-ink-faint">search</span>
            <kbd className="rounded-sm border border-edge px-1 text-[10px] text-ink-faint">⌘K</kbd>
          </button>
          <noscript>
            <form action="/search" role="search" className="hidden sm:block">
              <input
                type="search"
                name="q"
                placeholder="zcash> search"
                aria-label="Search the chain"
                className="panel w-40 px-3 py-1.5 text-xs text-ink outline-none placeholder:text-ink-faint"
              />
            </form>
          </noscript>
          {isTestnet ? null : <NavDonate />}
          {/* The network switcher sits at the far right: it is not a destination, it changes
              which chain every destination shows. Present on both deployments. */}
          <NetworkSwitch />
          {/* The theme menu sits beside the globe: a preference that changes how every page
              reads, not a destination. The one control on the site that writes to the
              visitor's browser — one key, disclosed on /privacy. */}
          <ThemeSwitch />
          <NavMenu />
        </div>
      </div>
    </nav>
  );
}
