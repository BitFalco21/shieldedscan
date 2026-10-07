"use client";

import Link from "@/components/Link";
import type { Fees24h, Transaction, TxKindFilter } from "@/domain";
import {
  isMixedDirectionFilter,
  publicValueZat,
  txKindFilterLabel,
  TX_KIND_FILTERS,
  TX_MIXED_DIRECTION_FILTERS,
  DAY_SECONDS,
} from "@/domain";
import { AmountZec } from "@/components/AmountZec";
import { CursorPagination } from "@/components/CursorPagination";
import { LiveAnnouncer } from "@/components/LiveAnnouncer";
import { LiveIndicator } from "@/components/LiveIndicator";
import { liveRowClass } from "@/lib/live-row";
import { LIVE_ROW_CAP, displayRows } from "@/lib/live-feed";
import { useDisplayNow } from "@/lib/use-display-now";
import { useLiveFeed } from "@/lib/use-live-feed";
import { DataTable, type TableColumn } from "@/components/DataTable";
import { FilterChips } from "@/components/FilterChips";
import { StatCard } from "@/components/StatCard";
import { StatGrid } from "@/components/StatGrid";
import { Unmeasured } from "@/components/Unmeasured";
import { Panel } from "@/components/Panel";
import { HashLink } from "@/components/HashLink";
import { DIRECTION_COLUMN, TxDirectionCell } from "@/components/TxDirectionCell";
import { KindPill } from "@/components/KindPill";
import {
  feeUsdAtDay,
  formatCount,
  formatUtc,
  formatZatUsd,
  formatZec,
  timeAgo,
} from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";

/**
 * VALUE: the public amount, or the Veil for a fully shielded transaction — the same pairing
 * `/block`, `/mempool` and the homepage use, so a row reads the same wherever it appears.
 *
 * `publicValueZat` is null only for a fully shielded transaction, so the veil always stands for a
 * value the chain encrypted, never one we failed to read. No dollar figure here, unlike FEE: USD
 * may sit only beside a genuinely public amount, and many rows in this column have none.
 */
const COLUMNS: TableColumn[] = [
  { label: "TX HASH" },
  // TYPE + DIRECTION: the kind and the path the value took. Kept in step with the address table so
  // the same row reads the same way wherever it appears.
  { label: "TYPE" },
  DIRECTION_COLUMN,
  { label: "VALUE", align: "right" },
  { label: "BLOCK" },
  // Fee is the one public per-row amount, so it may carry a dollar figure, priced at the row's own
  // date.
  { label: "FEE", align: "right" },
  { label: "TIME", align: "right" },
];

const kindHref = (value: TxKindFilter) => (value === "all" ? "/txs" : `/txs?kind=${value}`);

/**
 * Filter chip options for `/txs` — no cursor params, so selecting one resets paging.
 *
 * The two direction refinements do not get chips of their own: they live in the MIXED chip's
 * dropdown, because they are sub-cases of it rather than siblings. Putting all seven on one
 * row would say they partition the chain, and they do not — a shielding transaction is also a
 * mixed one, so the row's counts would appear to double-count.
 */
const FILTER_OPTIONS = TX_KIND_FILTERS.filter((value) => !isMixedDirectionFilter(value)).map(
  (value) => ({
    value,
    label: txKindFilterLabel(value),
    href: kindHref(value),
    ...(value === "mixed"
      ? {
          ownsValues: TX_MIXED_DIRECTION_FILTERS,
          menu: {
            ariaLabel: "Filter by shielded boundary direction",
            options: [
              // MIXED first and included in its own menu: it is the way back to the parent
              // once a refinement is in force, and a menu that can only narrow is a trap.
              { value: "mixed", label: "MIXED", href: kindHref("mixed") },
              ...TX_MIXED_DIRECTION_FILTERS.map((d) => ({
                value: d,
                label: txKindFilterLabel(d),
                href: kindHref(d),
              })),
            ],
          },
        }
      : {}),
  }),
);

/**
 * The chip's visible text. Refined, it names both levels — `MIXED · SHIELDING` — so a narrowed
 * table never sits under a chip that reads as its parent.
 */
function mixedChipLabel(activeKind: TxKindFilter): string {
  return isMixedDirectionFilter(activeKind)
    ? `MIXED · ${txKindFilterLabel(activeKind)}`
    : txKindFilterLabel("mixed");
}

/**
 * Lowercase noun phrase for a filter, e.g. "shielded transactions" or "transactions".
 *
 * The direction filters read as "shielding transactions", which is the vocabulary the TYPE
 * column on every row already uses — one word for one fact.
 */
function kindNounPhrase(kind: TxKindFilter): string {
  return kind === "all" ? "transactions" : `${kind} transactions`;
}

function EmptyTxs({ kind }: { kind: TxKindFilter }) {
  return <EmptyState>No {kindNounPhrase(kind)} on this page of the chain.</EmptyState>;
}

export interface TxsListPageProps {
  txs: Transaction[];
  now: number;
  /** Which privacy kind this page is filtered to; "all" shows every transaction. */
  /** Filter-aware total for the headline line; null renders nothing (count unavailable). */
  totalForKind: number | null;
  /** Daily closes for pricing each row's fee at its own date. */
  dailyUsd: Record<string, number>;
  priceUsd: number | null;
  /** Per-kind totals for the stat cards; null when the count could not be read. */
  counts: Record<string, number> | null;
  fees24h: Fees24h | null;
  txCount24h: number | null;
  activeKind: TxKindFilter;
  /** Href for the previous (newer) page; null when already at the head of the list. */
  newerHref: string | null;
  /** Href for the next (older) page; null when there is no older page. */
  olderHref: string | null;
  /** Href for the head of the list, preserving the active filter; null when already there. */
  newestHref: string | null;
  /** Href for the oldest page, preserving the active filter; null when already there. */
  oldestHref: string | null;
}

export function TxsListPage({
  txs,
  now,
  activeKind,
  newerHref,
  olderHref,
  newestHref,
  oldestHref,
  totalForKind,
  dailyUsd,
  priceUsd,
  counts,
  fees24h,
  txCount24h,
}: TxsListPageProps) {
  /*
   * Live rows grow this page; see `BlocksListPage` and `live-feed.ts` for why a cursored list must
   * never drop rows off its bottom.
   *
   * The poll carries the active filter and the endpoint echoes back the kind it applied; a mismatch
   * is discarded. Without the echo, an API one deploy behind would answer `?kind=shielding` with
   * every transaction on the chain, and no shape check can catch that — an unfiltered list is a
   * well-formed list.
   */
  const atTip = newestHref === null;
  const feed = useLiveFeed({
    kind: activeKind,
    mode: "grow",
    cap: LIVE_ROW_CAP,
    server: { transactions: txs },
    enabled: atTip,
  });
  const displayNow = useDisplayNow(feed.tip?.lastBlockTimestamp ?? now);

  const rows = displayRows(feed.transactions.rows, txs, {
    idOf: (t) => t.txid,
    sortKeyOf: (t) => t.timestamp,
  });
  const fresh = new Set(feed.transactions.freshIds);
  return (
    <>
      <LiveAnnouncer parts={[{ count: feed.transactions.freshIds.length, noun: "transaction" }]} />
      <PageHeader eyebrow="CHAIN" title="Transactions" />
      <StatGrid columns={4} className="mb-3">
        <StatCard
          label="TOTAL TRANSACTIONS"
          value={counts?.all !== undefined ? formatCount(counts.all) : <Unmeasured />}
          sub="all-time, including coinbase"
        />
        {/* Fees over the day divided by the day's transactions — both figures this page
            already trusts elsewhere, so the card cannot disagree with its neighbours. */}
        <StatCard
          label="AVG TXN FEE (24H)"
          value={
            fees24h !== null && txCount24h !== null && txCount24h > 0 ? (
              formatZec(Math.round(fees24h.zat / txCount24h))
            ) : (
              <Unmeasured />
            )
          }
          sub={
            fees24h !== null && txCount24h !== null && txCount24h > 0 && priceUsd !== null
              ? formatZatUsd(Math.round(fees24h.zat / txCount24h), priceUsd)
              : "needs the 24h window"
          }
        />
        <StatCard
          label="TOTAL SHIELDED TXNS"
          value={counts?.shielded !== undefined ? formatCount(counts.shielded) : <Unmeasured />}
          sub="fully shielded, all-time"
        />
        <StatCard
          label="TPS (24H)"
          value={txCount24h !== null ? (txCount24h / DAY_SECONDS).toFixed(3) : <Unmeasured />}
          sub={
            txCount24h !== null
              ? `${formatCount(txCount24h)} transactions`
              : "24h window not yet measured"
          }
        />
      </StatGrid>
      {/* Filter-aware line, only when a filter narrows the list — unfiltered it would
          restate the TOTAL TRANSACTIONS card word for word. */}
      {totalForKind !== null && activeKind !== "all" ? (
        <p className="mb-2 text-sm text-ink-dim">
          A total of <span className="text-ink tabular-nums">{formatCount(totalForKind)}</span>{" "}
          {`${activeKind} `}transactions
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <FilterChips
          options={FILTER_OPTIONS.map((option) =>
            option.value === "mixed" ? { ...option, label: mixedChipLabel(activeKind) } : option,
          )}
          activeValue={activeKind}
          ariaLabel="Filter by privacy kind"
        />
        {/* Absent, never "live", on a paged view — an indicator claiming to be live over a
            page that is deliberately not polling is the lie it exists to prevent. */}
        {atTip && (
          <LiveIndicator status={feed.status === "live" ? feed.transactions.status : feed.status} />
        )}
      </div>
      {rows.length === 0 ? (
        <div className="mt-3">
          <EmptyTxs kind={activeKind} />
        </div>
      ) : (
        <Panel className="mt-3">
          <DataTable caption="Transactions, newest first" columns={COLUMNS}>
            {rows.map((tx) => (
              <tr
                key={tx.txid}
                className={liveRowClass("row-hover hairline-b last:border-0", fresh.has(tx.txid))}
              >
                {/* One line where the table can hold it: on a phone (the wrapper scrolls) and
                    from `xl` up. Between `sm` and `xl` it may break after its ellipsis; from
                    `lg` the wrapper no longer scrolls, so the table must fit. */}
                <td className="whitespace-nowrap sm:max-xl:whitespace-normal">
                  <HashLink value={tx.txid} href={`/tx/${tx.txid}`} edge={8} copyable />
                </td>
                <td>
                  <KindPill tx={tx} />
                </td>
                {/* Hidden below `sm` with its header: on a phone the TYPE word already says
                    shielding or unshielding, and this column pushed VALUE off the screen. */}
                <TxDirectionCell tx={tx} />
                <td className="text-right whitespace-nowrap">
                  <AmountZec zat={publicValueZat(tx)} />
                </td>
                <td>
                  {tx.blockHeight !== null ? (
                    <Link
                      href={`/block/${tx.blockHeight}`}
                      className="text-green tabular-nums hover:underline"
                    >
                      #{formatCount(tx.blockHeight)}
                    </Link>
                  ) : (
                    <span className="microlabel text-ink-dim">PENDING</span>
                  )}
                </td>
                <td className="text-right text-xs whitespace-nowrap tabular-nums">
                  {/* A coinbase pays no fee — it collects the block's — so the cell reads
                      "none", not "unknown". */}
                  {tx.isCoinbase ? (
                    <span className="text-ink-faint">none</span>
                  ) : tx.feeZat !== null ? (
                    <>
                      <span className="text-ink">{formatZec(tx.feeZat)}</span>
                      {(() => {
                        const usd = feeUsdAtDay(tx.feeZat, tx.timestamp, dailyUsd, priceUsd, now);
                        return usd ? <span className="ml-1 text-ink-faint">{usd}</span> : null;
                      })()}
                    </>
                  ) : (
                    <span className="text-ink-faint">unknown</span>
                  )}
                </td>
                <td
                  className="text-right text-xs whitespace-nowrap text-ink-faint tabular-nums"
                  title={formatUtc(tx.timestamp)}
                >
                  {timeAgo(tx.timestamp, displayNow)}
                </td>
              </tr>
            ))}
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
