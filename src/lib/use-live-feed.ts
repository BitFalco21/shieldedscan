"use client";

import { useEffect, useRef, useState } from "react";
import type {
  BlockSummary,
  CrossChainDirectionFilter,
  CrossChainNarrowing,
  CrossChainTransfer,
  TxKindFilter,
  Transaction,
} from "@/domain";
import { matchesCrossChainFilters } from "@/domain";
import {
  EMPTY_LIVE_LIST,
  type LiveList,
  discardOnReorg,
  mergeLiveRows,
  rememberTip,
  reorgDetected,
} from "./live-feed";
import { type LivePayload, type LiveTip, parseLivePayload } from "@/data/live-payload";
import {
  CHASE_INTERVAL_MS,
  FAILURES_BEFORE_UNAVAILABLE,
  POLL_INTERVAL_MS,
  UNAVAILABLE_INTERVAL_MS,
  runPollLoop,
} from "./poll-cadence";

/**
 * Transport health, not per-list state. `capped` belongs to one list and is read from it
 * (`feed.blocks.status`), so a list nobody renders cannot report another page as capped.
 */
export type LiveFeedStatus = "live" | "unavailable" | "reorganised";

export interface LiveFeedOptions {
  kind: TxKindFilter;
  /** `grow` for a cursored list, `window` for a fixed panel. See `live-feed.ts`. */
  mode: "grow" | "window";
  cap: number;
  /**
   * The rows the server pass rendered, per feed. Rows rather than ids, because the merge needs
   * both the ids on screen and the newest row's sort key; deriving both here means a caller
   * cannot pass one without the other.
   */
  server: {
    blocks?: readonly BlockSummary[];
    transactions?: readonly Transaction[];
    transfers?: readonly CrossChainTransfer[];
  };
  intervalMs?: number;
  /** Test seam for the chase cadence; see `CHASE_INTERVAL_MS`. */
  chaseMs?: number;
  /** Test seam for the backed-off cadence; see `UNAVAILABLE_INTERVAL_MS`. */
  unavailableIntervalMs?: number;
  /**
   * Off for a cursored page that is not at the tip. Rows arriving at the head of the chain do
   * not belong on page 7, and prepending them there would claim they do. Defaults to on.
   */
  enabled?: boolean;
  /**
   * Narrowing applied to arriving transfers.
   *
   * `direction` (three values, so at most three cache keys) is sent to the endpoint, which
   * applies and echoes it, so a direction filter is a guarantee rather than a window. The other
   * filters are open-ended and would give the shared CDN entry a key per combination, so they
   * are applied here through `matchesCrossChainFilters`, the same predicate the store and
   * fixtures use. Limitation: a matching transfer outside the payload's window of newest
   * transfers appears only on reload.
   */
  transferFilters?: CrossChainNarrowing;
}

export interface LiveFeed {
  blocks: LiveList<BlockSummary>;
  transactions: LiveList<Transaction>;
  transfers: LiveList<CrossChainTransfer>;
  /** The chain tip the last accepted poll reported. Ages are measured against this. */
  tip: LiveTip | null;
  status: LiveFeedStatus;
}

function initialFeed(): LiveFeed {
  return {
    blocks: EMPTY_LIVE_LIST,
    transactions: EMPTY_LIVE_LIST,
    transfers: EMPTY_LIVE_LIST,
    tip: null,
    status: "live",
  };
}

interface FoldContext {
  /** Ids the server pass rendered, per list. */
  knownIds: { blocks: Set<string>; transactions: Set<string>; transfers: Set<string> };
  /** The newest sort key each list already shows. */
  floors: { blocks: number; transactions: number; transfers: number };
  cap: number;
  mode: "grow" | "window";
  markFresh: boolean;
}

/** One accepted poll folded into the feed: each list merged by its own id and sort key. */
function foldLivePayload(prev: LiveFeed, payload: LivePayload, ctx: FoldContext): LiveFeed {
  const shared = { cap: ctx.cap, mode: ctx.mode, markFresh: ctx.markFresh };
  return {
    blocks: mergeLiveRows(prev.blocks, payload.blocks, {
      idOf: (b) => b.hash,
      sortKeyOf: (b) => b.height,
      knownIds: ctx.knownIds.blocks,
      floor: ctx.floors.blocks,
      ...shared,
    }),
    transactions: mergeLiveRows(prev.transactions, payload.transactions, {
      idOf: (t) => t.txid,
      sortKeyOf: (t) => t.timestamp,
      knownIds: ctx.knownIds.transactions,
      floor: ctx.floors.transactions,
      ...shared,
    }),
    transfers: mergeLiveRows(prev.transfers, payload.transfers, {
      idOf: (t) => t.id,
      sortKeyOf: (t) => t.timestamp,
      knownIds: ctx.knownIds.transfers,
      floor: ctx.floors.transfers,
      ...shared,
    }),
    tip: payload.tip,
    status: "live",
  };
}

/**
 * Polls `/api/live` and folds each answer into the three live lists.
 *
 * Plumbing only (interval, visibility, failure counting, teardown): what a reader sees is
 * decided in `live-feed.ts`, and what may be believed in `live-payload.ts`.
 *
 * An enhancement, never a dependency: with scripting off, every page still renders server-side.
 */
export function useLiveFeed({
  kind,
  mode,
  cap,
  server,
  intervalMs = POLL_INTERVAL_MS,
  chaseMs = CHASE_INTERVAL_MS,
  unavailableIntervalMs = UNAVAILABLE_INTERVAL_MS,
  enabled = true,
  transferFilters,
}: LiveFeedOptions): LiveFeed {
  const [feed, setFeed] = useState<LiveFeed>(initialFeed);

  // Joined rather than passed by reference: the caller builds these arrays inline, so their
  // identity changes every render and using them directly as effect deps would poll in a loop.
  const serverBlocks = server.blocks ?? [];
  const serverTransactions = server.transactions ?? [];
  const serverTransfers = server.transfers ?? [];
  const knownBlocks = serverBlocks.map((b) => b.hash).join(",");
  const knownTransactions = serverTransactions.map((t) => t.txid).join(",");
  const knownTransfers = serverTransfers.map((t) => t.id).join(",");
  /*
   * The newest key each list already shows (`-Infinity` when the server rendered nothing).
   * Blocks use height and the other lists timestamp, matching each list's order.
   */
  const blockFloor = Math.max(Number.NEGATIVE_INFINITY, ...serverBlocks.map((b) => b.height));
  const txFloor = Math.max(Number.NEGATIVE_INFINITY, ...serverTransactions.map((t) => t.timestamp));
  const transferFloor = Math.max(
    Number.NEGATIVE_INFINITY,
    ...serverTransfers.map((t) => t.timestamp),
  );
  // Serialized for the same reason the id lists are: the caller builds this object inline, so
  // its identity changes every render and using it directly as a dep would poll in a loop.
  const transferFilterKey = JSON.stringify(transferFilters ?? null);
  // Sent to the endpoint rather than applied here; see `transferFilters`.
  const direction: CrossChainDirectionFilter = transferFilters?.direction ?? "all";

  const seenTips = useRef<Map<number, string>>(new Map());
  const failures = useRef(0);
  const halted = useRef(false);
  /**
   * The first accepted poll only establishes a baseline (see `markFresh` in `live-feed.ts`):
   * the page it reconciles against may be cached HTML, so its differences did not necessarily
   * arrive while the reader was watching.
   */
  const settled = useRef(false);

  /*
   * A changed server pass (filter change or fresh render) is a new baseline, so accumulated rows
   * are reset. Done during render, React's pattern for deriving state from props, so the stale
   * list never paints; a reset inside the effect would flash the previous filter's rows.
   */
  const baseline = `${enabled}|${kind}|${mode}|${cap}|${knownBlocks}|${knownTransactions}|${knownTransfers}|${transferFilterKey}`;
  const [renderedFor, setRenderedFor] = useState(baseline);
  if (renderedFor !== baseline) {
    setRenderedFor(baseline);
    setFeed(initialFeed());
  }

  useEffect(() => {
    if (!enabled) return;
    // Refs are not state, so these are safe to reset here — and they must be, since they carry
    // the reorg history and failure count belonging to the list that just went away.
    seenTips.current = new Map();
    failures.current = 0;
    halted.current = false;
    settled.current = false;

    const knownIds = {
      blocks: new Set(knownBlocks ? knownBlocks.split(",") : []),
      transactions: new Set(knownTransactions ? knownTransactions.split(",") : []),
      transfers: new Set(knownTransfers ? knownTransfers.split(",") : []),
    };

    const narrowing =
      transferFilterKey === "null" ? null : (JSON.parse(transferFilterKey) as CrossChainNarrowing);
    const controller = new AbortController();

    const fail = () => {
      failures.current += 1;
      if (failures.current >= FAILURES_BEFORE_UNAVAILABLE) {
        setFeed((prev) => (prev.status === "live" ? { ...prev, status: "unavailable" } : prev));
      }
    };

    /** True when the payload says a block exists that its own list has not shipped yet. */
    const poll = async (): Promise<boolean> => {
      // After a reorg the feed waits for a reload rather than accumulating under the banner.
      if (halted.current) return false;
      // A hidden tab is not reading; skip it.
      if (typeof document !== "undefined" && document.hidden) return false;

      try {
        const res = await fetch(
          `/api/live?kind=${encodeURIComponent(kind)}&direction=${encodeURIComponent(direction)}`,
          { signal: controller.signal },
        );
        if (!res.ok) throw new Error(`live poll failed: ${res.status}`);
        const parsed = parseLivePayload(await res.json(), kind, direction);

        if (parsed === null) {
          // An answer to a different question, or an unrecognised shape. Counted as a failure
          // so a persistent mismatch surfaces as "unavailable" instead of a silent freeze.
          fail();
          return false;
        }

        if (reorgDetected(seenTips.current, parsed.tip)) {
          halted.current = true;
          setFeed({
            blocks: discardOnReorg(),
            transactions: discardOnReorg(),
            transfers: discardOnReorg(),
            tip: parsed.tip,
            status: "reorganised",
          });
          return false;
        }

        seenTips.current = rememberTip(seenTips.current, parsed.tip);
        failures.current = 0;
        const markFresh = settled.current;
        settled.current = true;

        const arrivingTransfers = narrowing
          ? parsed.transfers.filter((t) => matchesCrossChainFilters(t, narrowing))
          : parsed.transfers;

        setFeed((prev) =>
          foldLivePayload(
            prev,
            { ...parsed, transfers: arrivingTransfers },
            {
              knownIds,
              floors: { blocks: blockFloor, transactions: txFloor, transfers: transferFloor },
              cap,
              mode,
              markFresh,
            },
          ),
        );

        const newestBlockRow =
          parsed.blocks.length > 0 ? Math.max(...parsed.blocks.map((b) => b.height)) : null;
        return newestBlockRow !== null && parsed.tip.height > newestBlockRow;
      } catch (error) {
        // An abort is our own teardown, not an outage, and must not count toward it.
        if (controller.signal.aborted || (error as Error)?.name === "AbortError") return false;
        fail();
      }
      return false;
    };

    const stop = runPollLoop({
      poll,
      failures: () => failures.current,
      intervalMs,
      chaseMs,
      unavailableIntervalMs,
    });
    return () => {
      stop();
      controller.abort();
    };
  }, [
    enabled,
    kind,
    mode,
    cap,
    intervalMs,
    chaseMs,
    unavailableIntervalMs,
    knownBlocks,
    knownTransactions,
    knownTransfers,
    blockFloor,
    txFloor,
    transferFloor,
    transferFilterKey,
    direction,
  ]);

  return feed;
}
