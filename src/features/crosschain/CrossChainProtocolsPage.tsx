import type { ReactNode } from "react";
import type {
  ChartRange,
  CrossChainProtocolStats,
  CrossChainProtocolSummary,
  CrossChainVolumeSide,
} from "@/domain";
import {
  CHART_RANGES,
  ZCASH_CHAIN,
  addSides,
  bothSides,
  protocolLabel,
  utcDayFromSeconds,
} from "@/domain";
import { ChainLogo } from "@/components/ChainLogo";
import { FilterChips } from "@/components/FilterChips";
import Link from "@/components/Link";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { ProtocolLogo } from "@/components/ProtocolLogo";
import { Unmeasured } from "@/components/Unmeasured";
import { chainName } from "@/lib/chains";
import {
  formatCount,
  formatSharePct,
  formatUsdCompact,
  formatZec,
  formatZecCompact,
  formatZecTwo,
  formatZecVolumeCompact,
  timeAgo,
} from "@/lib/format";
import { CrossChainTabs } from "./CrossChainTabs";
import { protocolsHref } from "./crossChainHref";
import { formatUsdAtSwap } from "./usd-at-swap";
import { windowPhrase } from "./window-copy";

export interface CrossChainProtocolsPageProps {
  summary: CrossChainProtocolSummary;
  range: ChartRange;
  /** Wall-clock seconds, for the relative "last swap" age. */
  now: number;
}

/** How many counterpart chains a card names before folding the rest into a count. */
const TOP_CHAINS = 3;

/**
 * A protocol's share of the ZEC crossed, refusing to round to a whole. A 99.97% share printed as
 * "100.0%" beside other cards carrying ZEC would state they carried nothing. Exactly 100 (one
 * protocol active) still prints 100.0%, because that is a measurement.
 */
export function protocolSharePct(pct: number): string {
  return pct < 100 && pct >= 99.95 ? ">99.9%" : formatSharePct(pct);
}

/**
 * The protocols side by side: who carried the ZEC that crossed.
 *
 * Cards rather than a table: a reader compares a few protocols across seven quantities, and a
 * seven-column table at 375px is a sideways scroll. Each card states the same rows in the same
 * order. The window is page-wide, as on the flows tab, so the cards stay comparable;
 * `firstSeenAt` and `lastSeenAt` are protocol facts rather than window figures, and labelled as
 * such.
 */
export function CrossChainProtocolsPage({ summary, range, now }: CrossChainProtocolsPageProps) {
  const { protocols, windowStart } = summary;
  const all = protocols.reduce<CrossChainVolumeSide>((acc, v) => addSides(acc, bothSides(v)), {
    transfers: 0,
    zecAmountZat: 0,
    usdAtSwap: 0,
    usdCoveredTransfers: 0,
  });
  const phrase = windowPhrase(range);
  const seen = protocols.map((v) => v.firstSeenAt).filter((t) => t > 0);
  const since = windowStart ?? (seen.length > 0 ? Math.min(...seen) : null);

  return (
    <>
      <PageHeader eyebrow={<>BRIDGES &amp; SWAPS</>} title="Cross-Chain" />

      <CrossChainTabs active="protocols" />

      <div className="mt-4">
        <FilterChips
          ariaLabel="Filter by time window"
          label="WINDOW"
          activeValue={range}
          options={CHART_RANGES.map((r) => ({
            value: r.value,
            label: r.label,
            href: protocolsHref(r.value),
          }))}
        />

        <Panel className="mt-3">
          {all.transfers === 0 ? (
            <p className="text-xl font-bold text-ink-bright">
              No swaps recorded at these protocols {phrase === null ? "yet" : `in ${phrase}`}.
            </p>
          ) : (
            <p className="text-xl font-bold text-ink-bright" data-protocols-headline>
              {formatCount(all.transfers)} swaps across {protocols.length} protocols ·{" "}
              {formatZecCompact(all.zecAmountZat)} · {formatUsdAtSwap(all)} at swap
            </p>
          )}
          <p className="mt-1 text-xs text-ink-faint">
            {since === null ? "" : `Since ${utcDayFromSeconds(since)} · `}public swap protocols
            only, so the real total is higher
          </p>
        </Panel>

        <div className="mt-3 grid gap-3 lg:grid-cols-3">
          {protocols.map((v) => (
            <ProtocolCard
              key={v.protocol}
              stats={v}
              allZat={all.zecAmountZat}
              now={now}
              phrase={phrase}
            />
          ))}
        </div>
      </div>
    </>
  );
}

function ProtocolCard({
  stats,
  allZat,
  now,
  phrase,
}: {
  stats: CrossChainProtocolStats;
  /** ZEC crossed at every protocol in the window — the denominator of this protocol's share. */
  allZat: number;
  now: number;
  phrase: string | null;
}) {
  const total = bothSides(stats);
  const share = allZat > 0 ? (total.zecAmountZat / allZat) * 100 : null;
  const name = protocolLabel(stats.protocol);

  return (
    <Panel fill className="min-w-0">
      <section
        aria-label={name}
        data-protocol={stats.protocol}
        data-filter-row={`${stats.protocol}:${total.transfers}:${total.zecAmountZat}`}
        className="flex h-full flex-col"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="inline-flex items-center gap-2 text-base font-bold text-ink-bright">
            <ProtocolLogo protocol={stats.protocol} />
            {name}
          </h2>
          {share === null ? null : (
            <span className="text-sm text-ink tabular-nums" data-protocol-share>
              {protocolSharePct(share)}
            </span>
          )}
        </div>

        {share === null ? null : (
          <>
            <ShareMeter pct={share} />
            <p className="mt-1 text-[11px] text-ink-faint">of ZEC crossed at these protocols</p>
          </>
        )}

        {total.transfers === 0 ? (
          <p className="mt-4 text-sm text-ink-dim">
            No swaps {phrase === null ? "recorded yet" : `in ${phrase}`}.
          </p>
        ) : (
          <dl className="mt-4 grid gap-3 text-sm">
            <Fact label="SWAPS" value={formatCount(total.transfers)}>
              {formatCount(stats.in.transfers)} in · {formatCount(stats.out.transfers)} out
            </Fact>
            <Fact
              label="ZEC CROSSED"
              value={formatZecTwo(total.zecAmountZat)}
              title={formatZec(total.zecAmountZat)}
            >
              {formatZecCompact(stats.in.zecAmountZat)} in ·{" "}
              {formatZecCompact(stats.out.zecAmountZat)} out
            </Fact>
            <Fact label="VALUE AT SWAP" value={formatUsdAtSwap(total)}>
              {formatUsdAtSwap(stats.in)} in · {formatUsdAtSwap(stats.out)} out
            </Fact>
            <Fact
              label="ROUTES"
              value={`${formatCount(stats.chains.length)} ${stats.chains.length === 1 ? "chain" : "chains"}`}
            >
              <TopChains stats={stats} />
            </Fact>
            <Fact label="LARGEST SWAP" value={<Largest largest={stats.largest} />} />
          </dl>
        )}

        <dl className="mt-auto grid grid-cols-2 gap-3 border-t border-edge-faint pt-3 text-xs">
          <div>
            <dt className="microlabel">FIRST SEEN</dt>
            <dd className="mt-1 text-ink-dim tabular-nums">
              {stats.firstSeenAt > 0 ? utcDayFromSeconds(stats.firstSeenAt) : "never"}
            </dd>
          </div>
          <div>
            <dt className="microlabel">LAST SWAP</dt>
            <dd className="mt-1 text-ink-dim tabular-nums">
              {stats.lastSeenAt > 0 ? timeAgo(stats.lastSeenAt, now) : "never"}
            </dd>
          </div>
        </dl>
      </section>
    </Panel>
  );
}

/** How many cells the share meter is drawn with — each one 2% of the ZEC crossed. */
export const SHARE_CELLS = 50;

/**
 * The lit state of each meter cell: `1` full, `0` dark, and one fractional cell for the
 * remainder. A sliver (say 0.05 of a cell) is neither rounded up to a full 2% cell nor drawn as
 * nothing: it is lit at its own fraction with a visible minimum, and the exact figure sits
 * beside the meter.
 */
export function shareCells(pct: number, cells = SHARE_CELLS): number[] {
  const exact = (Math.min(Math.max(pct, 0), 100) / 100) * cells;
  const full = Math.floor(exact);
  const rest = exact - full;
  return Array.from({ length: cells }, (_, i) =>
    i < full ? 1 : i === full && rest > 0 ? Math.max(rest, 0.25) : 0,
  );
}

/**
 * The share as a terminal meter: discrete cells in brackets, like the `/halving` epoch meter — a
 * row of blocks reads as a readout, a smooth bar as a progress widget. No glow. The fractional
 * cell's opacity is a class per quarter, never an inline style.
 */
function ShareMeter({ pct }: { pct: number }) {
  return (
    <div className="mt-2 flex items-center gap-1.5 font-mono text-xs text-ink-faint" aria-hidden>
      <span>[</span>
      <span className="flex h-2.5 flex-1 gap-px">
        {shareCells(pct).map((lit, i) => (
          <span
            key={i}
            data-cell={lit === 1 ? "full" : lit > 0 ? "part" : "off"}
            className={`flex-1 ${
              lit === 1
                ? "bg-green-dim"
                : lit === 0
                  ? "bg-green-faint opacity-40"
                  : lit >= 0.75
                    ? "bg-green-dim opacity-80"
                    : lit >= 0.5
                      ? "bg-green-dim opacity-60"
                      : "bg-green-dim opacity-40"
            }`}
          />
        ))}
      </span>
      <span>]</span>
    </div>
  );
}

/** A label, its figure, and a dim line of detail beneath — one atom, so they never separate. */
function Fact({
  label,
  value,
  title,
  children,
}: {
  label: string;
  value: ReactNode;
  title?: string;
  children?: ReactNode;
}) {
  return (
    <div>
      <dt className="microlabel">{label}</dt>
      {/* `relative` so a disclosure inside (the chains menu) can span the card's width. */}
      <dd className="relative mt-1">
        <span className="text-ink-bright tabular-nums" title={title}>
          {value}
        </span>
        {children === undefined ? null : (
          <span className="mt-0.5 block text-xs text-ink-dim tabular-nums">{children}</span>
        )}
      </dd>
    </div>
  );
}

/**
 * The protocol's biggest counterpart chains, each with its share of this protocol's ZEC (not the
 * market's). Each logo + ticker + share is one non-wrapping atom.
 */
function TopChains({ stats }: { stats: CrossChainProtocolStats }) {
  const protocolZat = bothSides(stats).zecAmountZat;
  const shown = stats.chains.slice(0, TOP_CHAINS);
  const rest = stats.chains.length - shown.length;
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-1">
      {shown.map((c) => {
        const zat = c.in.zecAmountZat + c.out.zecAmountZat;
        return (
          <span
            key={c.key}
            className="inline-flex items-center gap-1 whitespace-nowrap"
            title={chainName(c.key)}
          >
            <ChainLogo chain={c.key} />
            {c.key} {protocolZat > 0 ? formatSharePct((zat / protocolZat) * 100, 0) : ""}
          </span>
        );
      })}
      {rest > 0 ? <ChainsMenu stats={stats} rest={rest} /> : null}
    </span>
  );
}

/**
 * "+19 more", opening every chain of the protocol with its figures.
 *
 * `<details data-popover>` like the filter menus: no JavaScript to open, and `DismissPopovers`
 * closes it on an outside click or Escape. The panel hangs from the ROUTES row and spans the
 * card, never from the chip, whose position depends on how the chains before it wrap;
 * `e2e/cross-chain-protocols.spec.ts` opens it at 375px and measures.
 *
 * Every chain is listed, including the three shown inline, so the menu is the whole ranking.
 * Each row is both directions summed; dollars carry "≥" when a swap had no price. Not a
 * `.data-table`: its 24px gutters would push four columns past a ~300px card, so this keeps 8px
 * gutters.
 */
function ChainsMenu({ stats, rest }: { stats: CrossChainProtocolStats; rest: number }) {
  const protocolZat = bothSides(stats).zecAmountZat;
  const count = stats.chains.length;
  return (
    <details data-popover data-chains-menu>
      <summary
        aria-label={`+${rest} more — all ${count} chains with their volume`}
        className="inline-flex cursor-pointer list-none items-center gap-1 rounded-sm border border-edge-faint px-1.5 text-ink-dim transition-colors marker:content-none hover:border-edge hover:text-ink"
      >
        +{rest} more
        <svg viewBox="0 0 20 20" aria-hidden className="h-3 w-3" fill="currentColor">
          <path d="M4 7.5h12L10 14.5z" />
        </svg>
      </summary>
      <div className="panel absolute top-full right-0 left-0 z-30 mt-1 max-h-80 overflow-y-auto px-2.5 py-2">
        <table className="w-full text-xs tabular-nums">
          <caption className="microlabel mb-2 text-left">
            {protocolLabel(stats.protocol)} · all {count} chains · USD at swap
          </caption>
          <thead>
            <tr className="microlabel text-left">
              <th scope="col" className="border-b border-edge-faint pb-1.5 font-normal">
                CHAIN
              </th>
              <th
                scope="col"
                className="border-b border-edge-faint pb-1.5 pl-2 text-right font-normal"
              >
                ZEC
              </th>
              <th
                scope="col"
                className="border-b border-edge-faint pb-1.5 pl-2 text-right font-normal"
              >
                USD
              </th>
              <th
                scope="col"
                className="border-b border-edge-faint pb-1.5 pl-2 text-right font-normal"
              >
                SHARE
              </th>
            </tr>
          </thead>
          <tbody>
            {stats.chains.map((c) => {
              const both = bothSides(c);
              return (
                <tr key={c.key} className="hairline-b last:border-0">
                  <td className="py-1.5 pr-1">
                    <span
                      className="inline-flex items-center gap-1.5 whitespace-nowrap"
                      title={chainName(c.key)}
                    >
                      <ChainLogo chain={c.key} />
                      {c.key}
                    </span>
                  </td>
                  <td
                    className="py-1.5 pl-2 text-right whitespace-nowrap text-ink"
                    title={formatZec(both.zecAmountZat)}
                  >
                    {formatZecVolumeCompact(both.zecAmountZat)}
                  </td>
                  <td className="py-1.5 pl-2 text-right whitespace-nowrap text-ink-dim">
                    {formatUsdAtSwap(both)}
                  </td>
                  <td className="py-1.5 pl-2 text-right whitespace-nowrap text-ink-dim">
                    {protocolZat > 0
                      ? formatSharePct((both.zecAmountZat / protocolZat) * 100)
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** The largest swap: amount, route, day — linked to its transfer page. */
function Largest({ largest }: { largest: CrossChainProtocolStats["largest"] }) {
  if (largest === "unavailable") return <Unmeasured />;
  if (largest === null) return <span className="text-ink-dim">none</span>;
  const route =
    largest.direction === "in"
      ? `${largest.counterpartChain} → ${ZCASH_CHAIN}`
      : `${ZCASH_CHAIN} → ${largest.counterpartChain}`;
  return (
    <Link
      href={`/cross-chain/${encodeURIComponent(largest.id)}`}
      className="text-green hover:underline"
    >
      {/* One swap is a ledger amount, so all eight decimals — the `formatZecAmount` rule. */}
      {formatZec(largest.zecAmountZat)}
      <span className="mt-0.5 block text-xs text-ink-dim">
        {route} · {utcDayFromSeconds(largest.timestamp)}
        {largest.usdValueAtSwap === null
          ? ""
          : ` · ${formatUsdCompact(largest.usdValueAtSwap)} at swap`}
      </span>
    </Link>
  );
}
