import type { Pool } from "pg";
import { AddressCountTracker } from "../address-counts";
import { backfillFxRates, refreshRecentFxRates } from "../fx-history";
import { hostPacer } from "../job-pacer";
import { HttpNodeRpc } from "../node-rpc";
import { createPool } from "../pg-pool";
import { PoolUsageTracker, chainDayExtent } from "../pool-usage";
import { backfillPriceHistory, refreshRecentPrices } from "../price-history";
import { TransparentTracker, transparentDaysToCompute } from "../transparent-daily";

/** The primary's background jobs: work no request waits for, kept off the request path. */

type Log = (message: string) => void;

const HISTORY_REFRESH_MS = 6 * 60 * 60 * 1000;

/**
 * Backfill a history table once now, then refresh its recent days on a timer. Neither is awaited
 * and a failure is only logged: a third-party source must never delay the API listening, and its
 * outage must never stop the chain routes. The upserts are idempotent, so a backfill on every boot
 * is safe.
 */
function backfillThenRefresh(
  job: {
    name: string;
    /** What a failed backfill leaves, for its log line. */
    keeps: string;
    backfill: () => Promise<unknown>;
    refresh: () => Promise<unknown>;
  },
  log: Log,
): void {
  void job.backfill().catch((e: unknown) => {
    log(`${job.name}: backfill failed, ${job.keeps} — ${String(e)}`);
  });
  setInterval(() => {
    void job.refresh().catch((e: unknown) => {
      log(`${job.name}: refresh failed — ${String(e)}`);
    });
  }, HISTORY_REFRESH_MS).unref();
}

/**
 * Daily ZEC/USD closes and daily USD→currency rates: a ZEC amount in another currency is the day's
 * close times the day's rate. On a tiny pool of their own, so a slow third-party fetch writing
 * thousands of rows cannot hold connections the request path needs.
 */
export function startPriceAndFxHistory(databaseUrl: string | undefined, log: Log): void {
  const pool = createPool(databaseUrl, { max: 2 });
  backfillThenRefresh(
    {
      name: "price history",
      keeps: "prices stay as they were",
      backfill: () => backfillPriceHistory(pool, log),
      refresh: () => refreshRecentPrices(pool, log),
    },
    log,
  );
  backfillThenRefresh(
    {
      name: "fx rates",
      keeps: "rates stay as they were",
      backfill: () => backfillFxRates(pool, log),
      refresh: () => refreshRecentFxRates(pool, log),
    },
    log,
  );
}

/**
 * The day-grained trackers that walk the chain index: per-pool usage with its anonymity set,
 * transparent volume and active addresses, and every transparent address's transaction count.
 * Kept by the API's primary rather than the follower, so ingestion never pauses, and each on two
 * connections of its own and the host pacer, so a first pass over the whole chain yields to
 * ingestion between units.
 */
export function startChainTrackers(databaseUrl: string | undefined, nodeRpcUrl: string, log: Log) {
  const pacerFor = (pool: Pool) => () => hostPacer(pool, nodeRpcUrl, log);

  const usagePool = createPool(databaseUrl, { max: 2, statement_timeout: 30_000 });
  // The anonymity-set read needs the node's note-commitment tree sizes, on a client of its own.
  const usageRpc = new HttpNodeRpc(nodeRpcUrl);
  new PoolUsageTracker({
    pool: usagePool,
    trees: (height) => usageRpc.getBlockTrees(height),
    pacer: pacerFor(usagePool),
    log,
  }).start();
  log("pool usage tracker started");

  // A tracker of its own, because its first pass is the whole chain and must not hold back the
  // pool days. The day statement sets its own longer bound.
  const transparentPool = createPool(databaseUrl, { max: 2, statement_timeout: 60_000 });
  new TransparentTracker({ pool: transparentPool, pacer: pacerFor(transparentPool), log }).start();
  log("transparent tracker started");

  // Its first pass is a second walk of the whole io table, so it waits until the transparent
  // backfill has caught up: one chain-wide pass at a time beside ingestion.
  const addressCountPool = createPool(databaseUrl, { max: 2, statement_timeout: 60_000 });
  new AddressCountTracker({
    pool: addressCountPool,
    pacer: pacerFor(addressCountPool),
    log,
    ready: async () => {
      const extent = await chainDayExtent(addressCountPool, Math.floor(Date.now() / 1000));
      if (extent === null) return true;
      const pending = await transparentDaysToCompute(addressCountPool, extent.first, extent.last);
      // The newest three are recomputed on every pass; anything more is the backfill.
      return pending.length <= 3;
    },
  }).start();
  log("address count tracker started");
}
