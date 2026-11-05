import { startFollowing } from "./follow";
import { HttpNodeRpc } from "./node-rpc";
import { PostgresChainStore } from "./postgres-chain-store";
import { log, requirePostgres } from "./entrypoint";
import { createRefreshQueue, type RefreshJob } from "./refresh-queue";

/**
 * The chain follower, as its own process.
 *
 * Separate from the API container: ingest parses large JSON blocks continuously, and in the API's
 * single event loop that parsing would stall requests.
 *
 * It holds Postgres credentials and the node's RPC address and nothing else (no NEAR JWT, no API
 * bearer token): it never talks to a venue and never serves a request.
 */

const NODE_RPC_URL = process.env.NODE_RPC_URL ?? "http://zakura:8232";
const SCHEMA_PATH = process.env.CHAIN_SCHEMA_PATH ?? "./schema-chain.sql";
const BATCH = Number(process.env.FOLLOW_BATCH ?? 200);

// No in-memory fallback, unlike the cross-chain store: a follower that forgot its tip on restart
// would re-read the whole chain every boot.
requirePostgres("the follower has no in-memory mode");

/** "rollup" writes only the per-block row; "full" adds transactions and transparent I/O. */
const MODE = process.env.CHAIN_INGEST_MODE === "full" ? "full" : "rollup";

const store = new PostgresChainStore(process.env.DATABASE_URL, {
  rollupOnly: MODE === "rollup",
  // The follower owns the rich-list running totals: it is the only writer that advances strictly
  // one block at a time, which makes an incremental balance exact. The backfiller does not (see
  // `#maintainRichList`), and rollup mode has no `tx_transparent_io` rows to derive balances from.
  maintainRichList: MODE === "full",
  // The follower's write time is an arrival observation (see `#stampReceivedAt`); the backfiller
  // must never set this.
  stampReceivedAt: true,
});
await store.applySchema(SCHEMA_PATH);
log(`schema applied, mode=${MODE}, following ${NODE_RPC_URL} in batches of ${BATCH}`);

// Before following, not alongside it. The balances are a running total whose watermark only moves
// up, so if ingest applied the tip while a gap below it was still being walked, every block in the
// gap would fail the `height <= computed_height` guard and be skipped permanently. Awaiting makes
// the ordering structural.
if (MODE === "full") {
  await store.catchUpRichList(log);
}

const stop = startFollowing({
  rpc: new HttpNodeRpc(NODE_RPC_URL),
  store,
  log,
  batch: BATCH,
});

/**
 * Keep the materialised monthly series current.
 *
 * On a timer rather than per block: only the current month's row can change, so refreshing every
 * block would spend I/O on a change no reader can perceive. Ten minutes is well inside the
 * analytics pages' revalidation window.
 *
 * Failures are logged and swallowed. A refresh that cannot run leaves the view holding its
 * previous, still-true contents, whereas a rejection would take down the follower, and stopped
 * ingest is far worse than a chart a few minutes behind.
 */
const REFRESH_MS = Number(process.env.MONTHLY_REFRESH_MS ?? 600_000);

/**
 * Each view is refreshed and reported independently, never as one `Promise.all`: one failing is
 * no reason for the others to go stale.
 */
const VIEWS: RefreshJob[] = [
  { name: "monthly rollup", refresh: () => store.refreshMonthlyRollup() },
  { name: "shielding flow", refresh: () => store.refreshShieldingFlow() },
  { name: "fee kinds", refresh: () => store.refreshFeeKinds() },
  { name: "tx counts", refresh: () => store.refreshTxCounts() },
];

/**
 * The daily views behind the chart range toggles, on a slower cadence than the monthly set.
 *
 * A day-grain series changes perceptibly once a day, and these refreshes together cost about as
 * much as the whole monthly cycle (they re-scan `block` and `tx`). Hourly keeps the current day's
 * point at most an hour stale for a fraction of the I/O.
 */
const DAILY_VIEWS: RefreshJob[] = [
  { name: "daily rollup", refresh: () => store.refreshDayRollup() },
  { name: "daily shielding flow", refresh: () => store.refreshDayShieldingFlow() },
  { name: "daily fee kinds", refresh: () => store.refreshDayFeeKinds() },
  { name: "daily fee totals", refresh: () => store.refreshDayFeeTotals() },
  { name: "daily network", refresh: () => store.refreshDayNetwork() },
  // Two all-time rows rather than a daily series, but it belongs to this cadence: it is cheap next
  // to a group that already re-scans `block` and `tx`, and its figures move rarely.
  { name: "fee extremes", refresh: () => store.refreshFeeExtremes() },
  // Tops up only the heights added since the last pass, which is exact because extrema combine
  // across disjoint ranges. A no-op until the one-shot `repair-value-extremes` job has walked the
  // chain once, so it never pulls that walk into the follower's cycle.
  { name: "value extremes", refresh: () => store.refreshValueExtremes() },
];

const DAILY_REFRESH_MS = Number(process.env.DAILY_REFRESH_MS ?? 3_600_000);

/**
 * The per-pool day matviews, on their own timer.
 *
 * Not folded into `DAILY_VIEWS`: these scan `tx` where that group scans smaller matviews, so they
 * keep their own interval. They share the one refresh queue, so a cheap view can wait behind this
 * pass, at most once per interval.
 *
 * A full pass must stay well under its interval (the fill script enforces a 120 s gate). The
 * queue never runs two passes at once and skips a view still queued or running, so an overrun
 * skips the next pass instead of piling onto it.
 *
 * This timer cannot perform a first fill. A never-populated view forbids `CONCURRENTLY`, so
 * filling it takes an exclusive lock for an unmeasured scan in front of ingestion.
 * `refreshPoolAnalytics` refreshes only populated views and returns the names it skipped, which
 * are logged; the first fill of a new view is `npm run fill:pool-analytics`, run by an operator
 * through the pacer's preflight. Until then the view stays empty and its routes answer 503.
 */
const POOL_ANALYTICS_VIEWS: RefreshJob[] = [
  {
    name: "per-pool analytics",
    refresh: async () => {
      const pass = await store.refreshPoolAnalytics(log);
      return pass.rows;
    },
  },
];

/**
 * `0` (or any non-positive value) disables the group outright: no timer and no startup pass.
 * If this job ever costs more than it is worth, per-pool figures go stale while every other figure
 * keeps updating, chosen without a deploy.
 */
const POOL_ANALYTICS_REFRESH_MS = Number(process.env.POOL_ANALYTICS_REFRESH_MS ?? 3_600_000);
const POOL_ANALYTICS_ENABLED = POOL_ANALYTICS_REFRESH_MS > 0;

/**
 * Every refresh, from all three timers, goes through one queue that runs them one at a time
 * (`refresh-queue.ts`): passes started side by side compete for the same disk and stall the API's
 * reads behind them. A view still queued or running is skipped, not queued twice, so a pass that
 * outlives its interval cannot pile up behind itself.
 */
const refreshes = createRefreshQueue(log);
const runRefreshes = (views: RefreshJob[]) => refreshes.enqueue(views);

const refreshTimer = setInterval(() => runRefreshes(VIEWS), REFRESH_MS);
refreshTimer.unref();
const dailyRefreshTimer = setInterval(() => runRefreshes(DAILY_VIEWS), DAILY_REFRESH_MS);
dailyRefreshTimer.unref();
/*
 * Not run at boot. This one scans `tx`, and a crash-looping container
 * would start a full-chain scan on every restart. An hour of staleness on a per-pool figure is
 * cheaper, and a cold start gets its data from `npm run fill:pool-analytics`.
 */
if (POOL_ANALYTICS_ENABLED) {
  const poolAnalyticsTimer = setInterval(
    () => runRefreshes(POOL_ANALYTICS_VIEWS),
    POOL_ANALYTICS_REFRESH_MS,
  );
  poolAnalyticsTimer.unref();
} else {
  log("per-pool analytics refresh DISABLED (POOL_ANALYTICS_REFRESH_MS <= 0)");
}

/**
 * Stop between blocks rather than mid-block. `ingestBlock` is one transaction, so a hard kill
 * would roll back rather than corrupt anything, but a clean exit avoids a connection timing out
 * and keeps restarts quiet in the logs.
 */
const shutdown = (signal: string) => {
  log(`${signal} received, stopping after the current block`);
  stop();
  void store.close().then(() => process.exit(0));
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
