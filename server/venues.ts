import type { CrossChainTransfer } from "@/domain";
import { parseMidgardActions } from "@/data/crosschain/midgard";
import { parseIntentsTransactions } from "@/data/crosschain/near-intents";
import type { MidgardProtocol, MidgardVenue } from "@/data/crosschain/venues";
import { readJsonCapped } from "./body-limit";

/**
 * The networked half of ingest. Everything that decides *meaning* lives in the pure
 * parsers under `src/data/crosschain/`; this file only fetches bytes and hands them over.
 */

const MIDGARD_PAGE = 50; // Midgard silently clamps anything larger.
const INTENTS_BASE = "https://explorer.near-intents.org/api/v0/transactions";
/** The poller only needs the head; the backfill asks for the documented maximum. */
const INTENTS_POLL_PAGE = 250;
export const INTENTS_MAX_PAGE = 1000;
/**
 * What the backfill asks for: not the documented maximum. The endpoint fails on large pages when a
 * cursor is present (the head-only poller never hits this); 100 is the largest size verified to
 * work. The cost is only wall-clock, since the budget is one request per five seconds whatever
 * the page size.
 */
export const INTENTS_BACKFILL_PAGE = 100;

/**
 * The tightest rate limit in the system: one request per five seconds, per JWT, shared across
 * every process using that key. It is why ingest is a single long-lived poller rather than
 * serverless functions, whose many egress IPs share no state and would exhaust the budget.
 */
export const INTENTS_MIN_INTERVAL_MS = 5_200;

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return readJsonCapped(res);
}

export interface MidgardPage {
  transfers: CrossChainTransfer[];
  /** Raw action count, needed to tell "last page" from "no results". */
  rawCount: number;
}

export async function fetchMidgardPage(
  venue: MidgardVenue,
  protocol: MidgardProtocol,
  offset = 0,
): Promise<MidgardPage> {
  // `type=swap` server-side: Midgard also returns addLiquidity, withdraw and donate actions for the
  // asset, which are not cross-chain transfers and would inflate every figure.
  const url = `${venue.base}/v2/actions?asset=ZEC.ZEC&type=swap&limit=${MIDGARD_PAGE}&offset=${offset}`;
  // Some Midgard hosts rate-limit anonymous traffic and ask for an identifying header; sending one
  // costs nothing.
  const root = await fetchJson(url, { headers: { "x-client-id": "zcash-explorer" } }, 15_000);
  const actions = (root as { actions?: unknown[] } | null)?.actions;
  return {
    transfers: parseMidgardActions(root, protocol),
    rawCount: Array.isArray(actions) ? actions.length : 0,
  };
}

export interface IntentsCursor {
  lastDepositAddress: string;
  lastDepositMemo: string;
}

export interface IntentsPage {
  transfers: CrossChainTransfer[];
  rawCount: number;
  next: IntentsCursor | null;
}

/**
 * Exactly one of `fromChainId` / `toChainId` may be set — passing neither returns the
 * whole firehose, and the filter is also what excludes Intents' internal "masking"
 * transactions. Pagination is by cursor, where `direction=next` means *older*.
 */
export async function fetchIntentsPage(
  jwt: string,
  direction: "in" | "out",
  cursor: IntentsCursor | null = null,
  pageSize: number = INTENTS_POLL_PAGE,
): Promise<IntentsPage> {
  const params = new URLSearchParams({
    numberOfTransactions: String(Math.min(pageSize, INTENTS_MAX_PAGE)),
    statuses: "SUCCESS",
    direction: "next",
  });
  params.set(direction === "in" ? "toChainId" : "fromChainId", "zec");
  if (cursor) {
    params.set("lastDepositAddress", cursor.lastDepositAddress);
    // Only when there is a memo: an empty `lastDepositMemo=` makes the API discard the whole cursor
    // and return the head again, so the backfill would re-read the newest page forever.
    if (cursor.lastDepositMemo) params.set("lastDepositMemo", cursor.lastDepositMemo);
  }

  // 60 s, not 30: a large backfill page is a much heavier query than the poller's head read.
  const root = await fetchJson(
    `${INTENTS_BASE}?${params}`,
    { headers: { Authorization: `Bearer ${jwt}` } },
    60_000,
  );

  const rows = Array.isArray(root) ? (root as Array<Record<string, unknown>>) : [];
  const last = rows[rows.length - 1];
  return {
    transfers: parseIntentsTransactions(root),
    rawCount: rows.length,
    next:
      last === undefined
        ? null
        : {
            lastDepositAddress: String(last.depositAddress ?? ""),
            lastDepositMemo: String(last.depositMemo ?? ""),
          },
  };
}
