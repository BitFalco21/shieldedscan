"use client";

import type { BlockSummary, CrossChainTransfer, Transaction } from "@/domain";
import { LiveAnnouncer } from "@/components/LiveAnnouncer";
import { LiveIndicator } from "@/components/LiveIndicator";
import { isTestnet } from "@/lib/network";
import { displayRows } from "@/lib/live-feed";
import { useDisplayNow } from "@/lib/use-display-now";
import { useLiveFeed } from "@/lib/use-live-feed";
import { LatestBlocksPanel } from "./LatestBlocksPanel";
import { LatestCrossChainPanel } from "./LatestCrossChainPanel";
import { LatestTxsPanel } from "./LatestTxsPanel";

/**
 * The homepage's three latest-activity panels, kept current.
 *
 * One hook for three panels: `/api/live` returns all three feeds in a single payload, so
 * per-panel hooks would triple the polling and the cache lookups for one answer.
 *
 * Window mode is safe here and only here: these are fixed-size lists with no pagination, so
 * dropping the oldest row costs nothing. The list pages must grow instead; see `live-feed.ts`.
 *
 * Server-rendered rows arrive as props and are rendered on first paint, so with scripting off
 * the homepage is exactly what it is today. The live layer only ever adds.
 */

/**
 * The most rows any panel holds. Only a ceiling for what the hook accumulates — what each
 * panel SHOWS is its own server row count, see `sameLength` below.
 */
const MAX_PANEL_ROWS = 8;

/**
 * Each panel keeps exactly the size the server rendered it, ordered newest-first.
 *
 * The size comes from the server rows rather than a shared constant because the route asks for
 * 8 blocks, 8 transactions and only 4 transfers; the panels follow the route's limits instead
 * of restating them. The order comes from `displayRows`, which sorts rather than trusting the
 * merge.
 */
function panelRows<T>(
  live: readonly T[],
  server: readonly T[],
  idOf: (row: T) => string,
  sortKeyOf: (row: T) => number,
): T[] {
  return displayRows(live, server, { idOf, sortKeyOf, size: server.length });
}

export interface HomeLivePanelsProps {
  latestBlocks: BlockSummary[];
  latestTxs: Transaction[];
  latestTransfers: CrossChainTransfer[];
  /** The tip timestamp from the server render — the fallback until the first poll lands. */
  now: number;
}

export function HomeLivePanels({
  latestBlocks,
  latestTxs,
  latestTransfers,
  now,
}: HomeLivePanelsProps) {
  const feed = useLiveFeed({
    // The panels are unfiltered, so this shares one cache entry with /blocks and /cross-chain.
    kind: "all",
    mode: "window",
    cap: MAX_PANEL_ROWS,
    server: { blocks: latestBlocks, transactions: latestTxs, transfers: latestTransfers },
  });

  /*
   * Ages tick against the wall clock, floored at the chain tip, so the newest block does not
   * read "0s ago" until the next one lands. See `useDisplayNow`.
   */
  const displayNow = useDisplayNow(feed.tip?.lastBlockTimestamp ?? now);

  const blocks = panelRows(
    feed.blocks.rows,
    latestBlocks,
    (b) => b.hash,
    (b) => b.height,
  );
  const txs = panelRows(
    feed.transactions.rows,
    latestTxs,
    (t) => t.txid,
    (t) => t.timestamp,
  );
  const transfers = panelRows(
    feed.transfers.rows,
    latestTransfers,
    (t) => t.id,
    (t) => t.timestamp,
  );

  return (
    <>
      {/* One region for all three panels: a reader experiences a block landing as ONE event,
          and three live regions would talk over each other announcing it. */}
      <LiveAnnouncer
        parts={[
          { count: feed.blocks.freshIds.length, noun: "block" },
          { count: feed.transactions.freshIds.length, noun: "transaction" },
          { count: feed.transfers.freshIds.length, noun: "transfer" },
        ]}
      />
      {/* The wrapper is conditional too: an empty flex row still carries its margin. */}
      {feed.status !== "live" && (
        <div className="mt-3 flex justify-end">
          <LiveIndicator status={feed.status} />
        </div>
      )}
      <div
        className={`mt-3 grid gap-3 ${
          isTestnet ? "lg:grid-cols-2" : "lg:grid-cols-[1fr_1.15fr_1.25fr]"
        }`}
      >
        {/*
          Ages use `displayNow`: the server render's value on first paint (no hydration
          mismatch), then the wall clock floored at the tip the last poll reported.
        */}
        <LatestBlocksPanel blocks={blocks} now={displayNow} freshIds={feed.blocks.freshIds} />
        <LatestTxsPanel txs={txs} freshIds={feed.transactions.freshIds} />
        {!isTestnet && (
          <LatestCrossChainPanel transfers={transfers} freshIds={feed.transfers.freshIds} />
        )}
      </div>
    </>
  );
}
