import { startFollowing } from "./follow";
import { HttpNodeRpc } from "./node-rpc";
import { PostgresChainStore } from "./postgres-chain-store";
import { log, requirePostgres } from "./entrypoint";
import { createRefreshQueue, type RefreshJob } from "./refresh-queue";
import { DEFAULT_PASS_BUDGET_MS } from "./rollup/run";

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
 * Keep the rollup tables current: the day and month series and the all-time figures.
 *
 * Each pass recomputes only the periods the dirty-period log names (`server/rollup/`), so its cost
 * follows what changed, not the size of the chain: normally the open day and month. On a timer
 * rather than per block, because a series point a few minutes old is honest and a recompute per
 * block would spend I/O no reader can perceive. A backlog (a repair that rewrote history) drains
 * over several passes, newest month first, each bounded by `ROLLUP_PASS_BUDGET_MS`.
 *
 * `0` (or any non-positive value) disables it; marks then wait and are caught up exactly once it
 * is enabled again.
 *
 * Failures are logged and swallowed by the queue. A pass that cannot run leaves every table
 * holding its previous, still-true contents and its marks in place, whereas a rejection would take
 * down the follower, and stopped ingest is far worse than a chart a few minutes behind.
 */
const ROLLUP_REFRESH_MS = Number(process.env.ROLLUP_REFRESH_MS ?? 600_000);
const ROLLUP_PASS_BUDGET_MS = Number(process.env.ROLLUP_PASS_BUDGET_MS ?? DEFAULT_PASS_BUDGET_MS);

const ROLLUPS: RefreshJob[] = [
  {
    name: "rollups",
    refresh: async () => (await store.refreshRollups(log, ROLLUP_PASS_BUDGET_MS)) ?? undefined,
  },
];

/*
 * The materialized views a database holds until `swap-rollups` replaces them with the tables
 * above (production, during the migration). Each refresh acts only on a name that is still a view
 * and is a no-op once it is a table, so these timers stay until the cleanup that removes them.
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
 * This timer never performs a first fill: a never-populated view forbids `CONCURRENTLY`, so
 * filling it takes an exclusive lock for a whole scan in front of ingestion.
 * `refreshPoolAnalytics` skips such a view and names it.
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

if (ROLLUP_REFRESH_MS > 0) {
  const rollupTimer = setInterval(() => runRefreshes(ROLLUPS), ROLLUP_REFRESH_MS);
  rollupTimer.unref();
} else {
  log("rollup pass DISABLED (ROLLUP_REFRESH_MS <= 0) — marks wait until it is enabled");
}
const refreshTimer = setInterval(() => runRefreshes(VIEWS), REFRESH_MS);
refreshTimer.unref();
const dailyRefreshTimer = setInterval(() => runRefreshes(DAILY_VIEWS), DAILY_REFRESH_MS);
dailyRefreshTimer.unref();
/*
 * Not run at boot. This one scans `tx`, and a crash-looping container would start a full-chain
 * scan on every restart.
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
