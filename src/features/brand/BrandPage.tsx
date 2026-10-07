import { Panel } from "@/components/Panel";
import { PrivacyShield } from "@/components/PrivacyShield";
import { X_PROJECT_HANDLE, X_PROJECT_URL } from "@/lib/links";
import { PageHeader } from "@/components/PageHeader";

/**
 * The brand page: the marks, the palette, the type, and what anyone may do with them.
 *
 * Every swatch is rendered from the site's own design tokens rather than from a list of
 * hex values typed out beside them — a hardcoded table is a second source of truth that
 * silently goes stale the first time a token moves. The hex is printed for reference, from
 * the same constant the class resolves to.
 */

/**
 * The palette, with what each token is FOR. A colour list without its rule is decoration;
 * the constraints here are the interesting part — two of these must never carry text.
 */
const PALETTE: { name: string; hex: string; swatch: string; use: string }[] = [
  { name: "bg", hex: "#050805", swatch: "bg-bg", use: "the page. Near-black, never pure black" },
  { name: "panel", hex: "#0a120a", swatch: "bg-panel", use: "every panel and card surface" },
  {
    name: "green",
    hex: "#2bff64",
    swatch: "bg-green",
    use: "the accent — links, active state, the mark. Never body text",
  },
  { name: "green-dim", hex: "#17a344", swatch: "bg-green-dim", use: "secondary accent, Sapling" },
  {
    name: "green-faint",
    hex: "#0f4d24",
    swatch: "bg-green-faint",
    use: "decorative only — fails contrast as text",
  },
  { name: "ink-bright", hex: "#f2fff5", swatch: "bg-ink-bright", use: "headings" },
  { name: "ink", hex: "#d9ffe4", swatch: "bg-ink", use: "body text" },
  { name: "ink-dim", hex: "#7fbf93", swatch: "bg-ink-dim", use: "secondary text" },
  { name: "ink-faint", hex: "#5f8f70", swatch: "bg-ink-faint", use: "captions and micro-labels" },
  { name: "amber", hex: "#ffb020", swatch: "bg-amber", use: "chart series. Not an alert colour" },
  { name: "red", hex: "#ff5252", swatch: "bg-red", use: "negative deltas only" },
];

export function BrandPage() {
  return (
    <>
      <PageHeader
        eyebrow="BRAND"
        title="Brand identity"
        lede={
          <>
            The design language is called <span className="text-ink">Phosphor</span>: a cypherpunk
            terminal rendered as a phosphor tube. It is dark-only by design rather than by omission
            — there is no light theme and no toggle, because the whole system is built on the
            assumption of a glowing surface in a dark room.
          </>
        }
      />

      <Panel title="THE NAME">
        <div className="max-w-2xl space-y-3 py-1 text-sm leading-relaxed text-ink-dim">
          <p>
            The site is <span className="text-green">./shieldedscan</span> — written lowercase, with
            the leading <span className="font-mono text-ink">./</span>, the way you would run a
            local executable. In running prose, &ldquo;shieldedscan&rdquo; alone is fine.
            &ldquo;ShieldedScan&rdquo;, &ldquo;Shielded Scan&rdquo; and &ldquo;SHIELDEDSCAN&rdquo;
            are not the name.
          </p>
          <p>
            The domain is <span className="text-ink">shieldedscan.xyz</span>. The prefix is part of
            the identity, not a decoration: this is a tool, and the terminal grammar runs through
            the whole interface — navigation reads{" "}
            <span className="font-mono text-xs text-ink-faint">&gt; blocks</span>, search prompts
            read <span className="font-mono text-xs text-ink-faint">zcash&gt;</span>.
          </p>
        </div>
      </Panel>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Panel title="THE MARK">
          <div className="flex flex-col gap-5 py-1 sm:flex-row sm:items-start">
            <div className="flex shrink-0 flex-col items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- a 643-byte static SVG;
                  next/image passes SVG through unoptimised, and enabling dangerouslyAllowSVG
                  for one asset is backwards. Explicit dimensions reserve the box. */}
              <img
                src="/brand/shieldedscan-mark.svg"
                width={96}
                height={96}
                alt="The ./shieldedscan mark: the wordmark's opening characters inside a terminal window frame"
              />
              <a
                href="/brand/shieldedscan-mark.svg"
                className="text-[10px] tracking-widest text-ink-dim hover:text-green"
                download
              >
                SVG ↓
              </a>
            </div>
            <div className="min-w-0 space-y-3 text-sm leading-relaxed text-ink-dim">
              <p>
                A terminal window carrying the wordmark. It is a{" "}
                <span className="text-ink">treatment, not an assembly</span> — five earlier rounds
                stacked a rounded rectangle, a shield and a glyph, which is the icon every security
                product ships, and each one landed in the same anonymous place.
              </p>
              <p>
                At small sizes what survives is the neon frame rather than the words; the wordmark
                only resolves from roughly 128px up. That trade was made deliberately, choosing
                identity consistency over legibility in a browser tab.
              </p>
            </div>
          </div>
        </Panel>

        <Panel title="THE AVATAR">
          <div className="flex flex-col gap-5 py-1 sm:flex-row sm:items-start">
            <div className="flex shrink-0 flex-col items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- same reasoning as above;
                  a fixed-size raster served from this origin, box reserved by attributes. */}
              <img
                src="/brand/shieldedscan-avatar.png"
                width={96}
                height={96}
                alt="The ./shieldedscan profile avatar: the wordmark on two rows inside a neon terminal window"
              />
              <a
                href="/brand/shieldedscan-avatar.png"
                className="text-[10px] tracking-widest text-ink-dim hover:text-green"
                download
              >
                PNG ↓
              </a>
            </div>
            <div className="min-w-0 space-y-3 text-sm leading-relaxed text-ink-dim">
              <p>
                The social avatar: the same window, with the wordmark wrapped onto two rows and the
                logo&rsquo;s block cursor after it. It is{" "}
                <span className="text-ink">generated</span> from the site&rsquo;s own tokens by a
                script in the repository, not exported by hand — so it cannot drift from the design
                it came from.
              </p>
              <p>
                Note that platforms crop an avatar to a circle. The framed mark sits inside roughly
                0.707 of the canvas for that reason; scaled up to the edge, its corners vanish and
                it reads as four disconnected bands.
              </p>
            </div>
          </div>
        </Panel>
      </div>

      <Panel title="THE PRIVACY SHIELD" className="mt-3">
        <div className="py-1">
          <p className="max-w-2xl text-sm leading-relaxed text-ink-dim">
            Not a logo — the most important piece of vocabulary in the interface. One silhouette at
            three fill levels encodes what a transaction did, and it is drawn as SVG geometry rather
            than a coloured dot so that{" "}
            <span className="text-ink">shape is the primary channel</span> and colour is redundant
            reinforcement. A colourblind reader loses nothing.
          </p>
          <div className="mt-4 flex flex-wrap gap-8">
            {(
              [
                ["shielded", "Fully shielded", "no transparent side at all"],
                ["mixed", "Mixed", "one side shielded, one public"],
                ["transparent", "Transparent", "no shielding"],
              ] as const
            ).map(([variant, label, note]) => (
              <div key={variant} className="flex items-start gap-2">
                <PrivacyShield variant={variant} />
                <div>
                  <div className="text-sm text-ink">{label}</div>
                  <div className="text-xs text-ink-faint">{note}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Panel>

      <Panel title="PALETTE" className="mt-3">
        <div className="py-1">
          <p className="max-w-2xl text-sm leading-relaxed text-ink-dim">
            Every content colour is measured against the panel background and clears WCAG AA. Two of
            them are constrained rather than merely available: the accent green is bright enough to
            hum and is never used for body text, and{" "}
            <span className="text-ink">green-faint fails AA outright</span> — it is a border and a
            wash, never a letterform.
          </p>
          <ul className="mt-4 grid gap-x-8 gap-y-2 sm:grid-cols-2">
            {PALETTE.map((c) => (
              <li key={c.name} className="flex items-start gap-3">
                <span
                  className={`mt-0.5 inline-block h-5 w-5 shrink-0 rounded-sm border border-edge-faint ${c.swatch}`}
                  aria-hidden
                />
                <span className="min-w-0">
                  <span className="text-sm text-ink">{c.name}</span>{" "}
                  <span className="font-mono text-xs text-ink-faint">{c.hex}</span>
                  <span className="block text-xs text-ink-dim">{c.use}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </Panel>

      <Panel title="TYPE, AND THE GLOW BUDGET" className="mt-3">
        <div className="max-w-2xl space-y-3 py-1 text-sm leading-relaxed text-ink-dim">
          <p>
            <span className="text-ink">JetBrains Mono, for everything</span> — hashes, amounts, body
            copy, interface. Not just for code blocks: a monospace face is what makes a column of
            hashes and a column of amounts scannable, and mixing a proportional face for prose would
            break the terminal premise. It is self-hosted, so no font request ever leaves for a
            third party. Micro-labels are small, uppercase and letter-spaced.
          </p>
          <p>
            <span className="text-ink">Glow means something, so it is rationed.</span> Only four
            things on the entire site are allowed to bloom: the redaction bars that stand in for a
            shielded value, the filled shield, the logo&rsquo;s cursor, and the homepage headline.
            Everything else is flat. Scanlines appear in exactly one place — that same headline —
            because texture laid over numbers people came to read is texture in the way.
          </p>
          <p>
            All animation respects <span className="font-mono text-xs">prefers-reduced-motion</span>{" "}
            and stops entirely when it is set.
          </p>
        </div>
      </Panel>

      <Panel title="USING THESE" className="mt-3">
        <div className="max-w-2xl space-y-3 py-1 text-sm leading-relaxed text-ink-dim">
          <p>
            <span className="text-ink">You may, without asking:</span> use the name and mark to link
            to or refer to this site; show screenshots in an article, review, talk or comparison;
            credit the site as a source for a figure you took from it.
          </p>
          <p>
            <span className="text-ink">Please do not:</span> alter the mark&rsquo;s colours,
            proportions or geometry, or redraw it; use it as your own product or profile identity;
            or present it in a way that suggests this project endorses, sponsors or is affiliated
            with you or your product. Do not use it on anything that solicits keys, funds or
            personal information — see the{" "}
            <a href="/terms" className="text-green hover:underline">
              terms
            </a>
            , which state that this site never asks for a key.
          </p>
          <p>
            The marks and the site&rsquo;s design are the author&rsquo;s. Zcash and its ⓩ symbol are
            the Electric Coin Company&rsquo;s and appear here only to label ZEC, which is ordinary
            descriptive use and deliberately not this project&rsquo;s identity. Anything not covered
            above, or any use you are unsure about, just ask at{" "}
            <a
              href={X_PROJECT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-green hover:underline"
            >
              {X_PROJECT_HANDLE}
            </a>
            .
          </p>
        </div>
      </Panel>
    </>
  );
}
