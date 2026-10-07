import { PostgresChainStore } from "./postgres-chain-store";
import { log, requirePostgres } from "./entrypoint";

/**
 * One-shot rich-list bootstrap, an entrypoint in the follower's image:
 *
 *   docker run --rm --network <network> --env-file <db.env> \
 *     <follower-image> node bootstrap-rich-list.mjs
 *
 * `--rm` and no restart policy: this job finishes, and `--restart unless-stopped` would restart
 * a container that exits 0.
 *
 * This is the expensive path: the full aggregate over `tx_transparent_io`, which reads the whole
 * table off disk and is the heaviest thing on the host while it runs. `#applyBalanceDelta` exists
 * so this never has to run again; run it once, supervised, on a quiet host, and never on a timer.
 *
 * Needed for a fresh database, or after a wholesale invalidation of the running totals (for
 * example the fee repair re-resolving inputs across the chain). Balances and `computed_height` come out of one
 * transaction over one snapshot, so they cannot disagree; seeding from two separately refreshed
 * sources could skip deltas permanently, because the watermark only moves up.
 *
 * It applies no schema: a follower carrying the current `schema-chain.sql` must have started at
 * least once, or the tables will not exist. Safe to re-run: it replaces the tables wholesale in
 * one transaction.
 *
 * Env: PGHOST/DATABASE_URL (required). It makes no node calls.
 */

requirePostgres();

const store = new PostgresChainStore(process.env.DATABASE_URL);

const startedAt = Date.now();
try {
  log("rich-list bootstrap starting — full aggregate over tx_transparent_io, expect heavy I/O");
  await store.bootstrapRichList();
  const minutes = ((Date.now() - startedAt) / 60000).toFixed(1);
  const summary = await store.richListSummaryForCheck();
  log(
    `done in ${minutes}m: ${summary.addresses} addresses, ` +
      `${summary.totalZat} zat held, ${summary.unattributedZat} zat unattributed, ` +
      `computed at height ${summary.computedHeight}`,
  );
  // The reconciliation: balances plus unattributed value must equal the node's transparent value
  // pool at that height, which the follower stored on the block row. Any non-zero residual means
  // the list is wrong. Compare at a fixed height: two reads a few blocks apart differ by whatever
  // moved between them.
  if (summary.poolZat === null) {
    log("RECONCILE: no stored transparent pool at that height — check before trusting this list");
  } else {
    const residual = summary.poolZat - (summary.totalZat + summary.unattributedZat);
    log(
      `RECONCILE against the node's transparent pool at ${summary.computedHeight}: ` +
        `pool ${summary.poolZat} - (balances + unattributed) = ${residual} zat` +
        (residual === 0 ? " — exact" : " — NOT ZERO, do not serve this list"),
    );
  }
} catch (error) {
  log(`FATAL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await store.close();
}
