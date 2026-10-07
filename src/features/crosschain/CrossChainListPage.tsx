"use client";

import type { ReactNode } from "react";
import type {
  CrossChainFlow,
  CrossChainSide,
  CrossChainVolume,
  CrossChainVolumeSide,
  CrossChainTransfer,
} from "@/domain";
import {
  CROSSCHAIN_DIRECTION_FILTERS,
  CROSSCHAIN_MIN_USD_FILTERS,
  CROSSCHAIN_PROTOCOL_FILTERS,
  bothSides,
  chainFilterOptions,
  directionFilterLabel,
  minUsdFilterLabel,
  protocolFilterLabel,
  protocolLabel,
} from "@/domain";
import { ActiveFilterList } from "@/components/ActiveFilterList";
import { ChainLogo } from "@/components/ChainLogo";
import { ColumnFilter } from "@/components/ColumnFilter";
import { ColumnMultiFilter } from "@/components/ColumnMultiFilter";
import { CursorPagination } from "@/components/CursorPagination";
import { DataTable, type TableColumn } from "@/components/DataTable";
import { EmptyState } from "@/components/EmptyState";
import { FilterChips } from "@/components/FilterChips";
import Link from "@/components/Link";
import { LiveAnnouncer } from "@/components/LiveAnnouncer";
import { LiveIndicator } from "@/components/LiveIndicator";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { ProtocolLogo } from "@/components/ProtocolLogo";
import { StatCard } from "@/components/StatCard";
import { StatGrid } from "@/components/StatGrid";
import { StatusPill } from "@/components/StatusPill";
import { TransferLeg } from "@/components/TransferLeg";
import { Unmeasured } from "@/components/Unmeasured";
import { formatCount, formatUtc, formatZecCompact, timeAgo } from "@/lib/format";
import { LIVE_ROW_CAP, displayRows } from "@/lib/live-feed";
import { liveRowClass } from "@/lib/live-row";
import { useDisplayNow } from "@/lib/use-display-now";
import { useLiveFeed } from "@/lib/use-live-feed";
import { CrossChainTabs } from "./CrossChainTabs";
import {
  type CrossChainFilterState,
  EMPTY_CROSSCHAIN_FILTERS,
  crossChainHref,
  isFiltered,
  toCrossChainNarrowing,
  withChainToggled,
  withDirection,
  withSideCleared,
} from "./crossChainHref";
import { filterSentence, isUnsatisfiable, legsOf } from "./transferView";
import { formatUsdAtSwap } from "./usd-at-swap";

/**
 * Every control's links come from the same state with one field replaced, so changing one filter
 * cannot silently clear the others. Each drops the cursor, so a filter change resets to the
 * newest page.
 */
const protocolOptions = (state: CrossChainFilterState) =>
  CROSSCHAIN_PROTOCOL_FILTERS.map((value) => ({
    value,
    label: protocolFilterLabel(value),
    href: crossChainHref({ ...state, protocol: value }),
  }));

/**
 * `?min=` chips, present on all three direction tabs: a transfer's value is the same whichever
 * way it crossed. Chips above the table rather than a column funnel, because the ZEC amount sits
 * in SOURCE for an outbound row and DESTINATION for an inbound one.
 */
const minUsdOptions = (state: CrossChainFilterState) =>
  CROSSCHAIN_MIN_USD_FILTERS.map((value) => ({
    value: String(value),
    label: minUsdFilterLabel(value),
    href: crossChainHref({ ...state, minUsd: value }),
  }));

const directionOptions = (state: CrossChainFilterState, chains: readonly CrossChainFlow[]) =>
  CROSSCHAIN_DIRECTION_FILTERS.map((value) => ({
    value,
    label: directionFilterLabel(value),
    // Pruned, not just carried: under INBOUND a destination of SOL is unreachable rather
    // than merely empty, and a link that lands on an impossible view is a broken control.
    href: crossChainHref(withDirection(state, value, chains)),
  }));

/**
 * The chain menu for one side, or nothing.
 *
 * `null` when the side offers no chains — the chain list could not be read, or the direction in
 * force pins this side to Zcash. One option is still a menu: a lone toggle can be turned on and
 * off. Once a chain is chosen at most one side is offered, because choosing one pins the
 * direction (see `withChainToggled`).
 */
function chainFilterFor(
  side: CrossChainSide,
  options: string[],
  state: CrossChainFilterState,
): ReactNode {
  const selected = side === "source" ? state.sourceChains : state.destinationChains;
  const other = side === "source" ? state.destinationChains : state.sourceChains;
  // One end at a time, enforced in rendering as well as state. A URL carrying `?source=BTC` with
  // no direction arrives here with direction "all", so key on the other side's selection rather
  // than inferring a direction: `source=ZEC` means outbound while `source=BTC` means inbound.
  if (options.length === 0 || other.length > 0) return null;
  return (
    <ColumnMultiFilter
      ariaLabel={`Filter by ${side} chain`}
      // SOURCE is the first column, so a right-anchored panel would open off the left edge of a
      // phone. Escaping leftward adds no page scroll, so overflow checks cannot see it.
      align={side === "source" ? "left" : "right"}
      describeOption={(label) => `${label} as a ${side} chain`}
      clearHref={crossChainHref(withSideCleared(state, side))}
      options={options.map((chain) => ({
        value: chain,
        label: chain,
        // The chain's mark before its ticker: there is no amount column to keep aligned in a
        // menu, and a leading logo makes the list scannable.
        icon: <ChainLogo chain={chain} emphasis="normal" />,
        selected: selected.includes(chain),
        href: crossChainHref(withChainToggled(state, side, chain)),
      }))}
    />
  );
}

function columnsFor(
  state: CrossChainFilterState,
  chains: readonly CrossChainFlow[],
): TableColumn[] {
  const options = chainFilterOptions(chains, state.direction);
  return [
    { label: "SOURCE", control: chainFilterFor("source", options.source, state) },
    { label: "DESTINATION", control: chainFilterFor("destination", options.destination, state) },
    {
      // The header word is hidden on a phone, the filter control is not: the word alone would
      // set a wide column around a cell holding one 16px logo and push age (the link into the
      // transfer) off screen. `sr-only` keeps "PROTOCOL" for screen readers and for the e2e that
      // discovers filter groups by header text.
      label: <span className="sr-only sm:not-sr-only">PROTOCOL</span>,
      control: (
        <ColumnFilter
          options={protocolOptions(state)}
          activeValue={state.protocol}
          neutralValue="all"
          ariaLabel="Filter by venue"
        />
      ),
    },
    // STATUS is dropped on a phone. Nearly every row reads "completed"; the exception — a
    // pending transfer — is still on the detail page, and five columns do not fit in 390px.
    { label: "STATUS", className: "hidden sm:table-cell" },
    { label: "AGE", align: "right" },
  ];
}

function EmptyTransfers({ state }: { state: CrossChainFilterState }) {
  const side =
    state.direction === "all" ? "" : ` ${directionFilterLabel(state.direction).toLowerCase()}`;
  const venue = state.protocol === "all" ? "" : ` via ${protocolLabel(state.protocol)}`;
  return (
    <EmptyState>
      {isUnsatisfiable(state) ? (
        <>
          Every transfer here crosses the Zcash boundary, so ZEC is at exactly one end and the other
          end is the chain it came from or went to. This view asks for both ends at once, which no
          transfer can match — filter one end, and the direction says which.
        </>
      ) : (
        `No${side} cross-chain transfers${venue} match this view.`
      )}
    </EmptyState>
  );
}

export interface CrossChainListPageProps {
  transfers: CrossChainTransfer[];
  now: number;
  /** Filter-aware exact total; null renders nothing (count unavailable). */
  total: number | null;
  /** All-time per-direction volume; null degrades the cards to unavailable. */
  volume: CrossChainVolume | null;
  /** Every filter in force, and the single source every control's links are built from. */
  filters: CrossChainFilterState;
  /**
   * Per-chain flow, used only to decide which chains each menu may offer. `[]` when the
   * list could not be read, which renders no chain menus at all — an empty menu would
   * claim there is nothing to filter by. The active-filter line still shows and can still
   * clear a selection, so a filter is never inescapable.
   */
  chains: CrossChainFlow[];
  /** Href for the previous (newer) page; null when already at the head of the list. */
  newerHref: string | null;
  /** Href for the next (older) page; null when there is no older page. */
  olderHref: string | null;
  /** Href for the head of the list; null when it is already on screen. */
  newestHref: string | null;
  /** Href for the oldest page; null when it is already on screen. */
  oldestHref: string | null;
}

/**
 * Dollar first, ZEC beneath. The dollar is a floor whenever some transfers predate swap-time
 * prices, and the card says "at least" rather than hiding it.
 */
function VolumeCard({ label, side }: { label: string; side: CrossChainVolumeSide | null }) {
  if (side === null) {
    return <StatCard label={label} value={<Unmeasured />} sub="volume not readable" />;
  }
  return (
    <StatCard
      label={label}
      value={formatUsdAtSwap(side)}
      sub={`${formatZecCompact(side.zecAmountZat)} · at swap-time prices`}
    />
  );
}

export function CrossChainListPage({
  transfers,
  now,
  total,
  filters,
  chains,
  newerHref,
  olderHref,
  newestHref,
  oldestHref,
  volume,
}: CrossChainListPageProps) {
  /*
   * Live rows grow this page; see `live-feed.ts` for why a cursored list never drops its oldest
   * row.
   *
   * A filter narrows the live feed rather than switching it off. `/api/live` is keyed on `kind`
   * alone so every reader shares one CDN entry, so the narrowing is applied client-side through
   * the same `matchesCrossChainFilters` the store and fixtures use.
   */
  const atTip = newestHref === null;
  const live = atTip;
  const feed = useLiveFeed({
    kind: "all",
    mode: "grow",
    cap: LIVE_ROW_CAP,
    server: { transfers },
    enabled: live,
    transferFilters: toCrossChainNarrowing(filters),
  });
  const displayNow = useDisplayNow(feed.tip?.lastBlockTimestamp ?? now);

  const rows = displayRows(feed.transfers.rows, transfers, {
    idOf: (t) => t.id,
    sortKeyOf: (t) => t.timestamp,
  });
  const fresh = new Set(feed.transfers.freshIds);
  return (
    <>
      <LiveAnnouncer parts={[{ count: feed.transfers.freshIds.length, noun: "transfer" }]} />
      <PageHeader
        eyebrow={<>BRIDGES &amp; SWAPS</>}
        title="Cross-Chain"
        lede="ZEC entering and leaving via public swap protocols. The Zcash leg is public at the boundary — what happens after is private."
      />
      {/* USD is the sum of swap-time values the venues published, never today's price times
          historical ZEC — ZEC has moved roughly 10x across this data. Old rows carry no
          swap-time USD, so the figure is a floor and says so when coverage is short. */}
      <StatGrid columns={4} className="mb-3">
        <StatCard
          label="TOTAL TRANSFERS"
          value={
            volume !== null ? (
              formatCount(volume.in.transfers + volume.out.transfers)
            ) : (
              <Unmeasured />
            )
          }
          sub="public swap venues only"
        />
        <VolumeCard label="TOTAL VOLUME" side={volume === null ? null : bothSides(volume)} />
        <VolumeCard label="TOTAL OUTBOUND VOLUME" side={volume?.out ?? null} />
        <VolumeCard label="TOTAL INBOUND VOLUME" side={volume?.in ?? null} />
      </StatGrid>
      {total !== null && isFiltered(filters) ? (
        <p className="mb-2 text-sm text-ink-dim">
          A total of <span className="text-ink tabular-nums">{formatCount(total)}</span>{" "}
          {filterSentence(filters)}
        </p>
      ) : null}
      <CrossChainTabs active="transfers" className="mb-4" />
      {/* Direction gets chips above the table; venue and the chain menus get icons in their
          column headers. Direction is the primary way to read this page and reshapes the
          whole list; the others refine what is on screen, so each lives on the column it acts
          on. All are links, survive paging, and drop the cursor. */}
      <FilterChips
        options={directionOptions(filters, chains)}
        activeValue={filters.direction}
        ariaLabel="Filter by direction"
        label="DIRECTION"
      />
      {/* "VALUE AT SWAP" matters: these are the venues' prices at the moment of each swap, so
          two rows are priced in different eras' dollars. Bare dollar signs would read as
          today's money, a figure we do not have. */}
      <div className="mt-2">
        <FilterChips
          options={minUsdOptions(filters)}
          activeValue={String(filters.minUsd)}
          ariaLabel="Filter by value at swap"
          label="VALUE AT SWAP"
        />
      </div>
      {/* A funnel says that a chain filter is applied, not which; the selections are spelled
          out here, each removable. This is also the only way to clear a selection when the
          chain list is unreadable and the menus are absent. */}
      {filters.sourceChains.length + filters.destinationChains.length > 0 ? (
        <div className="mt-2">
          <ActiveFilterList
            ariaLabel="Active chain filters"
            clearHref={crossChainHref({
              ...EMPTY_CROSSCHAIN_FILTERS,
              protocol: filters.protocol,
              direction: filters.direction,
            })}
            groups={(["source", "destination"] as const).map((side) => ({
              label: side.toUpperCase(),
              values: (side === "source" ? filters.sourceChains : filters.destinationChains).map(
                (chain) => ({
                  label: chain,
                  icon: <ChainLogo chain={chain} emphasis="normal" />,
                  removeHref: crossChainHref(withChainToggled(filters, side, chain)),
                }),
              ),
            }))}
          />
        </div>
      ) : null}
      {/* Absent whenever the feed is off. An indicator reading "live" over a list that is not
          polling would be false. */}
      {live && (feed.status !== "live" || feed.transfers.status !== "live") && (
        <div className="mt-2 flex justify-end">
          <LiveIndicator status={feed.status === "live" ? feed.transfers.status : feed.status} />
        </div>
      )}
      {rows.length === 0 ? (
        <EmptyTransfers state={filters} />
      ) : (
        <Panel>
          <DataTable
            caption="Cross-chain transfers, newest first"
            columns={columnsFor(filters, chains)}
          >
            {rows.map((t) => {
              const { source, destination } = legsOf(t);
              return (
                <tr
                  key={t.id}
                  className={liveRowClass(
                    "row-hover hairline-b align-top last:border-0",
                    fresh.has(t.id),
                  )}
                >
                  <td>
                    <TransferLeg {...source} role="from" />
                  </td>
                  <td>
                    <div className="flex items-start gap-1.5 sm:gap-3">
                      <span aria-hidden className="pt-5 text-ink-faint">
                        →
                      </span>
                      <TransferLeg {...destination} role="to" />
                    </div>
                  </td>
                  <td>
                    {/* The mark alone on a phone, mark + name above it: the logos are real
                        brand silhouettes, so the icon already identifies the venue. The label
                        stays available to screen readers either way. */}
                    <span
                      className="inline-flex items-center gap-1.5 rounded-sm px-0 py-1 text-xs whitespace-nowrap text-ink-dim sm:border sm:border-edge-faint sm:px-2.5"
                      title={protocolLabel(t.protocol)}
                    >
                      <ProtocolLogo protocol={t.protocol} />
                      <span className="sr-only sm:not-sr-only">{protocolLabel(t.protocol)}</span>
                    </span>
                  </td>
                  <td className="hidden sm:table-cell">
                    <StatusPill status={t.status} />
                  </td>
                  <td className="text-right text-xs whitespace-nowrap text-ink-faint">
                    <Link
                      href={`/cross-chain/${t.id}`}
                      aria-label={`Transfer ${t.id}`}
                      className="inline-flex items-center gap-2 hover:text-ink hover:underline"
                    >
                      <span className="tabular-nums" title={formatUtc(t.timestamp)}>
                        {timeAgo(t.timestamp, displayNow)}
                      </span>
                      <span aria-hidden className="hidden sm:inline">
                        ›
                      </span>
                    </Link>
                  </td>
                </tr>
              );
            })}
          </DataTable>
        </Panel>
      )}
      <CursorPagination
        newerHref={newerHref}
        olderHref={olderHref}
        newestHref={newestHref}
        oldestHref={oldestHref}
      />
    </>
  );
}
