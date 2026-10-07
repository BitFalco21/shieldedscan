import { startFollowing } from "./follow";
import { HttpNodeRpc } from "./node-rpc";
import { PostgresChainStore } from "./postgres-chain-store";
import { log, requirePostgres } from "./entrypoint";

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
 * Each view is refreshed and reported independently, never as one `Promise.all`: they read
 * different tables at different costs, and one failing is no reason for the others to go stale.
 */
const VIEWS: { name: string; refresh: () => Promise<void> }[] = [
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
const DAILY_VIEWS: { name: string; refresh: () => Promise<void> }[] = [
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
 * The rich list's rank column, on its own timer.
 *
 * Balances are maintained per block by `#applyBalanceDelta`; rank is the one column a per-block
 * delta cannot maintain, because crediting one address renumbers every address below it. The
 * recompute reads only `chain_address_balance`, never `tx_transparent_io`.
 *
 * Kept as its own group because its cadence answers a different question (how stale a printed
 * rank may be) and so it has its own switch.
 */
const RICH_LIST_VIEWS: { name: string; refresh: () => Promise<void | number> }[] = [
  { name: "rich list ranks", refresh: () => store.refreshRichListRanks() },
];

/**
 * `0` (or any non-positive value) disables the group outright: no timer and no startup pass.
 * Balances stay current without it; only `rank` goes stale.
 */
const RICH_LIST_REFRESH_MS = Number(process.env.RICH_LIST_REFRESH_MS ?? 3_600_000);
const RICH_LIST_ENABLED = RICH_LIST_REFRESH_MS > 0;

/**
 * The per-pool day matviews, on their own timer.
 *
 * Not folded into `DAILY_VIEWS`: these scan `tx` where that group scans smaller matviews, and
 * grouping them would make a cheap chart's freshness depend on an expensive one.
 *
 * A full pass must stay well under its interval (the fill script enforces a 120 s gate): a pass
 * that outlives its interval overlaps the next, each overlap competes for the same disk, and it
 * does not converge. `runRefreshes` skips an overlapping pass as a backstop.
 *
 * This timer cannot perform a first fill. A never-populated view forbids `CONCURRENTLY`, so
 * filling it takes an exclusive lock for an unmeasured scan in front of ingestion.
 * `refreshPoolAnalytics` refreshes only populated views and returns the names it skipped, which
 * are logged; the first fill of a new view is `npm run fill:pool-analytics`, run by an operator
 * through the pacer's preflight. Until then the view stays empty and its routes answer 503.
 */
const POOL_ANALYTICS_VIEWS: { name: string; refresh: () => Promise<void | number> }[] = [
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
 * Views currently being refreshed, so a timer never starts a second pass over one still running.
 *
 * `setInterval` fires on wall-clock time regardless of the previous pass, so once a refresh takes
 * longer than its interval the passes overlap, each overlap competes for the same disk, and every
 * pass gets slower: it does not converge and can starve the whole host.
 *
 * Skipping rather than queueing: these are full recomputations, so a skipped pass costs nothing.
 * It is logged, because a view that silently stops refreshing looks exactly like a fresh one.
 */
const refreshing = new Set<string>();

function runRefreshes(views: { name: string; refresh: () => Promise<void | number> }[]) {
  for (const view of views) {
    if (refreshing.has(view.name)) {
      log(`${view.name} refresh SKIPPED — the previous pass is still running`);
      continue;
    }
    refreshing.add(view.name);
    const startedAt = Date.now();
    void view
      .refresh()
      // A refresh that reports how many rows it changed logs it (`refreshRichListRanks` does),
      // which is the input to deciding whether an hourly full pass is the right shape.
      .then((rows) =>
        log(
          `${view.name} refreshed in ${Date.now() - startedAt}ms` +
            (typeof rows === "number" ? ` (${rows} rows changed)` : ""),
        ),
      )
      .catch((error: unknown) =>
        log(`${view.name} refresh FAILED (view keeps its previous contents): ${String(error)}`),
      )
      .finally(() => refreshing.delete(view.name));
  }
}

const refreshTimer = setInterval(() => runRefreshes(VIEWS), REFRESH_MS);
refreshTimer.unref();
const dailyRefreshTimer = setInterval(() => runRefreshes(DAILY_VIEWS), DAILY_REFRESH_MS);
dailyRefreshTimer.unref();
// Run once at start as well as on the timer, so a follower that has been down does not serve
// ranks from before the gap for another hour. Safe at boot because the job reads only the
// balance table.
if (RICH_LIST_ENABLED) {
  runRefreshes(RICH_LIST_VIEWS);
  const richListRefreshTimer = setInterval(
    () => runRefreshes(RICH_LIST_VIEWS),
    RICH_LIST_REFRESH_MS,
  );
  richListRefreshTimer.unref();
} else {
  log("rich list rank refresh DISABLED (RICH_LIST_REFRESH_MS <= 0) — balances still update");
}

/*
 * Not run at boot, unlike the rich list above. This one scans `tx`, and a crash-looping container
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
