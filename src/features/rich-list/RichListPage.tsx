import Link from "@/components/Link";
import type { ExchangeReserveSummary, RichListEntry, RichListSummary } from "@/domain";
import { ExchangeReservesPanel } from "./ExchangeReservesPanel";
import { BAND_BOUNDARIES_ZEC, addressLabel, shareOfTransparent } from "@/domain";
import { CopyButton } from "@/components/CopyButton";
import { CursorPagination } from "@/components/CursorPagination";
import { DataTable, type TableColumn } from "@/components/DataTable";
import { FlushEnd } from "@/components/FlushEnd";
import { Panel } from "@/components/Panel";
import { CellShareBar } from "@/components/CellShareBar";
import type { CoinAgePoint } from "@/domain/coin-age";
import { CoinAgePanel } from "./CoinAgePanel";
import { StatCard } from "@/components/StatCard";
import { StatGrid } from "@/components/StatGrid";
import { Unmeasured } from "@/components/Unmeasured";
import {
  formatCount,
  formatSharePct,
  formatZatUsdCompact,
  formatZecBalance,
  formatZecWhole,
  shortHash,
} from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";
import { LabelIcon } from "@/components/LabelIcon";

export interface RichListPageProps {
  entries: RichListEntry[];
  summary: RichListSummary;
  /**
   * Live ZEC price, or null when it is unmeasured — which is also the permanent answer on
   * testnet, where TAZ has no market. The dollar column is ABSENT rather than empty in that
   * case: a header over a column of blanks reads as a chart that failed to draw, and pricing
   * a worthless coin would be worse still.
   */
  priceUsd: number | null;
  /**
   * The exchanges' labelled balances. Absent on testnet, where the labels name nothing; null
   * when the series could not be read, and the section says so.
   */
  exchangeReserves?: ExchangeReserveSummary | null;
  /** Coin age at the newest block it covers; null (no panel) while it cannot be read. */
  coinAge?: CoinAgePoint | null;
  newerHref: string | null;
  olderHref: string | null;
  newestHref: string | null;
  oldestHref: string | null;
}

/**
 * The dollar column exists only where there is a price to state it in, so the header is built
 * per render rather than declared once.
 */
function columnsFor(priceUsd: number | null): TableColumn[] {
  return [
    { label: "#" },
    { label: "ADDRESS" },
    { label: "NAME TAG", className: "hidden sm:table-cell" },
    { label: "BALANCE", align: "right" },
    ...(priceUsd === null
      ? []
      : [{ label: "USD", align: "right", className: "hidden sm:table-cell" } as TableColumn]),
    { label: "SHARE", align: "right" },
    { label: "TXNS", align: "right", className: "hidden sm:table-cell" },
  ];
}

/**
 * A band's label, from its own bounds — "1 – 10 ZEC", "100K+ ZEC".
 *
 * Compact above a thousand, so the table fits its panel at 375px; the bounds are round powers
 * of ten, so nothing is lost.
 */
function bandLabel(index: number): string {
  const from = BAND_BOUNDARIES_ZEC[index]!;
  const to = BAND_BOUNDARIES_ZEC[index + 1];
  const n = (v: number) => (v >= 1_000 ? `${v / 1_000}K` : String(v));
  if (from === 0) return `under ${n(BAND_BOUNDARIES_ZEC[1]!)} ZEC`;
  return to === undefined ? `${n(from)}+ ZEC` : `${n(from)} – ${n(to)} ZEC`;
}

export function RichListPage({
  entries,
  summary,
  priceUsd,
  exchangeReserves,
  coinAge = null,
  newerHref,
  olderHref,
  newestHref,
  oldestHref,
}: RichListPageProps) {
  // Only meaningful once there ARE more than 100 addresses: below that the card reads
  // "100.0% of transparent value", which is true and tells a reader nothing. Reachable on a
  // young testnet chain, not only in fixtures.
  const top100 = summary.topShares.find((t) => t.count === 100 && summary.addressCount > 100);

  return (
    <>
      <PageHeader
        eyebrow="CHAIN"
        title="Transparent rich list"
        lede="Every transparent address holding ZEC, largest first. Shielded value has no rich list and cannot have one."
      />

      <StatGrid columns={top100 ? 3 : 2}>
        <StatCard
          label="ADDRESSES"
          value={formatCount(summary.addressCount)}
          sub="holding a balance"
        />
        <StatCard
          label="TRANSPARENT VALUE"
          value={formatZecWhole(summary.totalZat)}
          sub={`at block ${formatCount(summary.height)}`}
        />
        {top100 ? (
          <StatCard
            label="TOP 100 HOLD"
            value={formatSharePct(shareOfTransparent(top100.totalZat, summary.totalZat) * 100, 2)}
            sub="of transparent value"
          />
        ) : null}
      </StatGrid>

      <Panel title="DISTRIBUTION" className="mt-3">
        <div className="overflow-x-auto">
          {/*
              Four columns in ~303px at 375px. `min-w` is deliberately low: raising it pushes
              SHARE off a phone screen. The width comes from places that cost no information:
              the share bar drops below `sm` (the figure says the same thing), the ADDRESSES
              header abbreviates, and the band label is the one column free to wrap, which keeps
              the other three on one line so figures never touch.

              It wears `.data-table`'s look, whose 0.75rem gutters would widen this table on a
              phone, so below `sm` the `max-sm:pe-*` utilities set narrower gaps.
            */}
          <table className="data-table w-full min-w-[17rem] text-sm">
            <caption className="sr-only">Transparent addresses and value, by balance band</caption>
            <thead>
              <tr className="microlabel text-left">
                <th className="border-b border-edge-faint pb-2 font-normal whitespace-nowrap max-sm:pe-0">
                  BAND
                </th>
                {/* Abbreviated on a phone: a header wider than its cells sets the column width,
                    and the caption and full header carry the meaning. */}
                <th className="border-b border-edge-faint pb-2 text-right font-normal whitespace-nowrap max-sm:pe-0">
                  <span className="sm:hidden">
                    <FlushEnd>ADDR</FlushEnd>
                  </span>
                  <span className="hidden sm:inline">
                    <FlushEnd>ADDRESSES</FlushEnd>
                  </span>
                </th>
                <th className="border-b border-edge-faint pb-2 text-right font-normal max-sm:pe-1">
                  <FlushEnd>HELD</FlushEnd>
                </th>
                <th className="border-b border-edge-faint pb-2 font-normal">SHARE</th>
              </tr>
            </thead>
            <tbody>
              {/* Largest band first, matching the table below. `bands` arrives ascending, so
                  the index is captured before reversing (`bandLabel` reads it for the bounds),
                  and `.map` first so `.reverse()` never mutates `summary.bands`. */}
              {summary.bands
                .map((band, i) => ({ band, i }))
                .reverse()
                .map(({ band, i }) => {
                  const pct = shareOfTransparent(band.totalZat, summary.totalZat) * 100;
                  return (
                    <tr key={band.fromZat} className="hairline-b last:border-0">
                      {/* Wraps on a phone and stays on one line from `sm`. Its siblings are
                          all nowrap, so this column takes the leftover width and must be
                          allowed two lines rather than force the table wider than the panel. */}
                      <td className="text-ink-dim max-sm:pe-0 sm:whitespace-nowrap">
                        {bandLabel(i)}
                      </td>
                      <td className="text-right font-mono whitespace-nowrap text-ink-dim max-sm:pe-0">
                        {formatCount(band.addresses)}
                      </td>
                      <td className="text-right font-mono whitespace-nowrap text-ink-bright max-sm:pe-1">
                        {formatZecBalance(band.totalZat)}
                      </td>
                      <td className="sm:w-2/5">
                        <div className="font-mono text-xs whitespace-nowrap text-ink-faint">
                          {formatSharePct(pct, 2)}
                        </div>
                        {/* SVG `width` attribute, not an inline style; geometry and the
                            reasoning behind the cells live on `CellShareBar`. */}
                        <CellShareBar pct={pct} />
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </Panel>

      {exchangeReserves === undefined ? null : <ExchangeReservesPanel summary={exchangeReserves} />}
      {coinAge ? <CoinAgePanel point={coinAge} /> : null}

      <Panel className="mt-3">
        <DataTable
          caption="Transparent addresses by balance, largest first"
          columns={columnsFor(priceUsd)}
        >
          {entries.map((e) => (
            <tr key={e.address} className="row-hover hairline-b last:border-0">
              <td className="font-mono text-sm text-ink-faint tabular-nums">
                {formatCount(e.rank)}
              </td>
              <td>
                <Link
                  href={`/address/${e.address}`}
                  className="font-mono text-sm text-ink hover:text-green"
                  title={e.address}
                >
                  {shortHash(e.address, 8)}
                </Link>
                {/* The clipboard gets the untruncated address; the link shows an elision. */}
                <CopyButton value={e.address} label="address" />
              </td>
              {/*
               * The name, and nothing else; the labelling basis is recorded per entry in
               * `domain/address-label.ts`, not rendered.
               *
               * An unnamed address gets an empty cell, never an em dash or a repeat of the
               * address: nearly every address is unnamed, and a placeholder on 843,000 rows is
               * noise standing in for nothing.
               *
               * The name is resolved from the address with `addressLabel`, never read off the
               * row, so one editorial table answers on every page and no deployment skew can
               * blank the column.
               *
               * Hidden below `sm`, like USD and TXNS: at 375px every name wraps to three lines
               * and the extra width pushes SHARE behind a sideways scroll. The name is one tap
               * away on the address page.
               */}
              <td className="hidden text-sm text-ink-dim sm:table-cell">
                <NameTag address={e.address} />
              </td>
              <td className="text-right font-mono text-sm whitespace-nowrap text-ink-bright">
                {formatZecBalance(e.balanceZat)}
              </td>
              {priceUsd === null ? null : (
                <td className="hidden text-right font-mono text-sm whitespace-nowrap text-ink-faint sm:table-cell">
                  {formatZatUsdCompact(e.balanceZat, priceUsd)}
                </td>
              )}
              <td className="text-right font-mono text-sm text-ink-dim">
                {formatSharePct(shareOfTransparent(e.balanceZat, summary.totalZat) * 100, 2)}
              </td>
              <td className="hidden text-right font-mono text-sm text-ink-faint sm:table-cell">
                {/*
                 * Never `?? 0`. A null is a row the backfill has not reached, and an address in
                 * this table has been in at least one transaction by construction — so a zero
                 * here would be a number the truth cannot take, dressed as a measurement.
                 */}
                {e.txCount === null ? <Unmeasured /> : formatCount(e.txCount)}
              </td>
            </tr>
          ))}
        </DataTable>
      </Panel>

      <CursorPagination
        newerHref={newerHref}
        olderHref={olderHref}
        newestHref={newestHref}
        oldestHref={oldestHref}
      />

      <p className="mt-3 text-xs leading-relaxed text-ink-faint">
        Every share is of the transparent total above. Balances are every output to an address minus
        every input from it, from this site&apos;s own chain index.{" "}
        {formatZecBalance(summary.unattributedZat)} sits in outputs naming no single address and is
        excluded.
      </p>
    </>
  );
}

/** An unnamed address gets an empty cell — no icon standing beside nothing. */
function NameTag({ address }: { address: string }) {
  const label = addressLabel(address);
  if (!label) return null;
  return (
    <span className="inline-flex items-center gap-1.5">
      <LabelIcon />
      {label.name}
    </span>
  );
}
