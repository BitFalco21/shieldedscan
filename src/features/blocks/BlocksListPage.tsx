"use client";
import { network } from "@/lib/network";

import type { BlockMiner, BlockSummary, Fees24h } from "@/domain";
import { blockFeesZat, targetSpacingSeconds, DAY_SECONDS } from "@/domain";
import { CursorPagination } from "@/components/CursorPagination";
import { LiveAnnouncer } from "@/components/LiveAnnouncer";
import { LiveIndicator } from "@/components/LiveIndicator";
import { liveRowClass } from "@/lib/live-row";
import { LIVE_ROW_CAP, displayRows } from "@/lib/live-feed";
import { useDisplayNow } from "@/lib/use-display-now";
import { useLiveFeed } from "@/lib/use-live-feed";
import { StatCard } from "@/components/StatCard";
import { StatGrid } from "@/components/StatGrid";
import { Unmeasured } from "@/components/Unmeasured";
import { DataTable, type TableColumn } from "@/components/DataTable";
import { Panel } from "@/components/Panel";
import { AddressLink } from "@/components/AddressLink";
import { HashLink } from "@/components/HashLink";
import { PrivacyShield, privacyCountLabel, type PrivacyVariant } from "@/components/PrivacyShield";
import {
  feeUsdAtDay,
  formatBytes,
  formatCount,
  formatUtc,
  formatZatUsd,
  formatZec,
  timeAgo,
} from "@/lib/format";
import Link from "@/components/Link";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { ShieldedMiner } from "./ShieldedMiner";

const VARIANT_ORDER: PrivacyVariant[] = ["shielded", "mixed", "transparent"];

const COLUMNS: TableColumn[] = [
  { label: "HEIGHT" },
  { label: "HASH" },
  { label: "MINER" },
  { label: "TXS" },
  { label: "POOLS" },
  { label: "SIZE" },
  { label: "FEES", align: "right" },
  { label: "TIME", align: "right" },
];

/**
 * Which privacy kinds this block contains. Read off the block's own composition counts,
 * so a row costs no transaction fetch — see `BlockComposition` in the domain.
 *
 * Each shield names its kind AND its count on hover, because the count is already in hand
 * and a bare "transparent" would be the smaller half of what this column knows. The
 * coinbase is inside the transparent tally, which is what `BlockComposition` documents as
 * describing what a block *contains*.
 */
function CompositionDots({ block }: { block: BlockSummary }) {
  const counts: Record<PrivacyVariant, number> = {
    shielded: block.composition.shieldedTxs,
    mixed: block.composition.mixedTxs,
    transparent: block.composition.transparentTxs,
  };
  return (
    <span className="inline-flex items-center gap-1.5">
      {VARIANT_ORDER.filter((v) => counts[v] > 0).map((v) => (
        <PrivacyShield key={v} variant={v} label={privacyCountLabel(v, counts[v])} />
      ))}
    </span>
  );
}

/**
 * Who took the block reward. A shielded coinbase is redacted rather than blanked — the
 * miner is unknowable there by design, and that is a fact about Zcash worth stating in
 * the same ink the rest of the explorer uses for it.
 */
function MinerCell({ miner }: { miner: BlockMiner }) {
  if (miner.kind === "transparent") {
    return <AddressLink address={miner.address} edge={6} />;
  }
  if (miner.kind === "shielded") {
    return <ShieldedMiner glyphs={4} />;
  }
  return <span className="text-xs text-ink-faint">no payee</span>;
}

function EmptyBlocks() {
  return <EmptyState>No blocks match this view.</EmptyState>;
}

/**
 * "page x of y" without a COUNT(*) — the one keyset list where that is honest arithmetic.
 *
 * Heights are dense and start at 0, so with the newest block on the page and the tip, both
 * numbers fall out: x from how far below the tip this page starts, y from the tip itself.
 * The timestamp-sorted lists (/txs, /cross-chain) have no such derivation, which is why they
 * show no ordinal at all. The ordinal drifts by one as new blocks land.
 */
export function blocksPageLabel(
  blocks: BlockSummary[],
  tipHeight: number,
  pageSize: number,
): string | null {
  const top = blocks[0]?.height;
  if (top === undefined || tipHeight < top) return null;
  const page = Math.floor((tipHeight - top) / pageSize) + 1;
  const pages = Math.ceil((tipHeight + 1) / pageSize);
  return `page ${formatCount(page)} of ${formatCount(pages)}`;
}

export interface BlocksListPageProps {
  blocks: BlockSummary[];
  now: number;
  /** Chain tip, for deriving the page ordinal — heights make it free, no count involved. */
  tipHeight: number;
  /** Daily closes for pricing each block's fees at its own date. */
  dailyUsd: Record<string, number>;
  priceUsd: number | null;
  fees24h: Fees24h | null;
  txCount24h: number | null;
  /** The route's page size; the ordinal arithmetic must use the same number. */
  pageSize: number;
  /** Href for the previous (newer) page; null when already at the head of the chain. */
  newerHref: string | null;
  /** Href for the next (older) page; null when there is no older page. */
  olderHref: string | null;
  /** Href for the head of the chain; null when it is already on screen. */
  newestHref: string | null;
  /** Href for the oldest page; null when it is already on screen. */
  oldestHref: string | null;
}

export function BlocksListPage({
  blocks,
  tipHeight,
  pageSize,
  now,
  newerHref,
  olderHref,
  newestHref,
  oldestHref,
  dailyUsd,
  priceUsd,
  fees24h,
  txCount24h,
}: BlocksListPageProps) {
  /*
   * Live rows grow this page rather than replacing its oldest: `olderHref` carries a keyset
   * cursor derived from the last server row, so a row dropped off the bottom would become
   * reachable from no page. That is why `mode: "grow"` stops at the cap and says so.
   *
   * Only at the tip: on a paged view `newestHref` is set, and prepending "new" rows onto page 7
   * would claim they belong there.
   */
  const atTip = newestHref === null;
  const feed = useLiveFeed({
    kind: "all",
    mode: "grow",
    cap: LIVE_ROW_CAP,
    server: { blocks },
    enabled: atTip,
  });
  const displayNow = useDisplayNow(feed.tip?.lastBlockTimestamp ?? now);

  const rows = displayRows(feed.blocks.rows, blocks, {
    idOf: (b) => b.hash,
    sortKeyOf: (b) => b.height,
  });
  const fresh = new Set(feed.blocks.freshIds);
  return (
    <>
      <LiveAnnouncer parts={[{ count: feed.blocks.freshIds.length, noun: "block" }]} />
      <PageHeader eyebrow="CHAIN" title="Blocks" />
      {/* Every figure here derives from two measurements the page already trusts —
          fees24h (total + block count over the trailing day) and txCount24h — so the four
          cards cannot disagree with each other or with /analytics. */}
      <StatGrid columns={4} className="mb-3">
        <StatCard
          label="TXS PER BLOCK (24H)"
          value={
            fees24h !== null && txCount24h !== null && fees24h.blocksTotal > 0 ? (
              (txCount24h / fees24h.blocksTotal).toFixed(1)
            ) : (
              <Unmeasured />
            )
          }
          sub="excluding coinbase"
        />
        <StatCard
          label="AVG BLOCK FEE (24H)"
          value={
            fees24h !== null && fees24h.blocksTotal > 0 ? (
              formatZec(Math.round(fees24h.zat / fees24h.blocksTotal))
            ) : (
              <Unmeasured />
            )
          }
          sub={
            fees24h !== null && fees24h.blocksTotal > 0 && priceUsd !== null
              ? formatZatUsd(Math.round(fees24h.zat / fees24h.blocksTotal), priceUsd)
              : "needs the 24h window"
          }
        />
        <StatCard
          label="BLOCK TIME (24H)"
          value={
            fees24h !== null && fees24h.blocksTotal > 0 ? (
              `${(DAY_SECONDS / fees24h.blocksTotal).toFixed(1)} s`
            ) : (
              <Unmeasured />
            )
          }
          sub={`measured, target is ${targetSpacingSeconds(network, tipHeight)} s`}
        />
        <StatCard
          label="BLOCKS (24H)"
          value={fees24h !== null ? formatCount(fees24h.blocksTotal) : <Unmeasured />}
          sub="in the trailing day"
        />
      </StatGrid>
      {/* tip+1 IS the total — heights are dense, so this is arithmetic, not a COUNT. */}
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-sm text-ink-dim">
          A total of <span className="text-ink tabular-nums">{formatCount(tipHeight + 1)}</span>{" "}
          blocks
        </p>
        {/* Absent, never "live", on a paged view: an indicator claiming to be live over a page
            that is not polling would be a lie. The cap belongs to the list, everything else to
            the feed. */}
        {atTip && (
          <LiveIndicator status={feed.status === "live" ? feed.blocks.status : feed.status} />
        )}
      </div>
      {rows.length === 0 ? (
        <EmptyBlocks />
      ) : (
        <Panel>
          <DataTable caption="Blocks, newest first" columns={COLUMNS}>
            {rows.map((b) => (
              <tr
                key={b.hash}
                className={liveRowClass("row-hover hairline-b last:border-0", fresh.has(b.hash))}
              >
                <td className="whitespace-nowrap">
                  <Link
                    href={`/block/${b.height}`}
                    className="font-semibold text-green tabular-nums hover:underline"
                  >
                    #{formatCount(b.height)}
                  </Link>
                </td>
                {/* One line on a phone and from `lg` up; between `sm` and `lg` it may break
                    after its ellipsis, where the table is widest relative to its panel. */}
                <td className="whitespace-nowrap sm:max-lg:whitespace-normal">
                  <HashLink value={b.hash} href={`/block/${b.hash}`} edge={8} copyable />
                </td>
                <td className="whitespace-nowrap">
                  <MinerCell miner={b.miner} />
                </td>
                <td className="text-ink-dim tabular-nums">{b.txCount}</td>
                <td>
                  <CompositionDots block={b} />
                </td>
                {/* `whitespace-nowrap`: "4.0 kB" and "2m ago" are one quantity each. */}
                <td className="whitespace-nowrap text-ink-dim tabular-nums">
                  {formatBytes(b.sizeBytes)}
                </td>
                <td className="text-right text-xs whitespace-nowrap tabular-nums">
                  {/* `blockFeesZat`, not `b.totalFeeZat`: a block holding only its coinbase
                      collects no fees by construction, so it is exactly 0 even before ingest has
                      written the row the index reads. */}
                  {blockFeesZat(b) !== null ? (
                    <>
                      <span className="text-ink">{formatZec(blockFeesZat(b)!)}</span>
                      {(() => {
                        const usd = feeUsdAtDay(
                          blockFeesZat(b)!,
                          b.timestamp,
                          dailyUsd,
                          priceUsd,
                          now,
                        );
                        return usd ? <span className="ml-1 text-ink-faint">{usd}</span> : null;
                      })()}
                    </>
                  ) : (
                    <span className="text-ink-faint">unknown</span>
                  )}
                </td>
                <td
                  className="text-right text-xs whitespace-nowrap text-ink-faint tabular-nums"
                  title={formatUtc(b.timestamp)}
                >
                  {timeAgo(b.timestamp, displayNow)}
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
        rangeLabel={blocksPageLabel(blocks, tipHeight, pageSize)}
      />
    </>
  );
}
