import type { Pool } from "pg";
import type { Manifest } from "../opendata/manifest";
import { expectedRows, type ImportPlan } from "./plan";
import { ADDRESS_SNAPSHOT_TABLE } from "./units";

/**
 * The imported database held to the release, and to itself. Each check reads the imported rows,
 * so it proves what the database holds, not what was sent:
 *
 *  - every table holds the manifest's row count, the blocks are 0..N with N's hash the release's,
 *    and the follower's resume point is that block;
 *  - each block's transactions agree with its row (count, kinds, fee total, Sapling and Orchard
 *    flows), the exporter's `TxChecker` identities;
 *  - the rich list built from the ledger plus the unattributed value equals the node's transparent
 *    pool at N, to the zatoshi, and equals the release's own `addresses` snapshot.
 *
 * Returns the failures; an empty list is a pass.
 */

const EXAMPLES = 5;

export async function verifyImport(
  pool: Pool,
  manifest: Manifest,
  plan: ImportPlan,
): Promise<string[]> {
  const failures: string[] = [];
  const count = async (table: string) =>
    Number(
      (await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table}`)).rows[0]!.n,
    );

  const tables: [string, Parameters<typeof expectedRows>[1]][] = [
    ["block", "blocks"],
    ["tx", "transactions"],
    ["tx_transparent_io", "transparent_io"],
    ["pool_usage_daily", "pool_usage_daily"],
    ["boundary_daily", "boundary_daily"],
    ["transparent_daily", "transparent_daily"],
    ["transparent_monthly", "transparent_monthly"],
  ];
  for (const [table, kind] of tables) {
    const [got, want] = [await count(table), expectedRows(plan, kind)];
    if (got !== want) failures.push(`${table}: ${got} rows, the release has ${want}`);
  }

  const blocks = await pool.query<{ lo: number; hi: number; n: string; hash: string | null }>(
    `SELECT min(height) AS lo, max(height) AS hi, count(*)::text AS n,
            (SELECT hash FROM block WHERE height = $1) AS hash
       FROM block`,
    [manifest.height],
  );
  const b = blocks.rows[0]!;
  if (b.lo !== 0 || b.hi !== manifest.height || Number(b.n) !== manifest.height + 1) {
    failures.push(`blocks span ${b.lo}..${b.hi} (${b.n} rows), expected 0..${manifest.height}`);
  }
  if (b.hash !== manifest.hash) {
    failures.push(`block ${manifest.height} is ${b.hash}, the release says ${manifest.hash}`);
  }

  const sync = await pool.query<{ tip_height: number; tip_hash: string }>(
    "SELECT tip_height, tip_hash FROM chain_sync_state",
  );
  const s = sync.rows[0];
  if (s?.tip_height !== manifest.height || s.tip_hash !== manifest.hash) {
    failures.push(`chain_sync_state is ${s?.tip_height ?? "empty"}, expected ${manifest.height}`);
  }

  // One aggregate over `tx`, the per-block identities the exporter checked before publishing.
  const perBlock = await pool.query<{ height: number }>(
    `WITH t AS (
       SELECT block_height AS h, count(*) AS n,
              count(*) FILTER (WHERE kind = 'transparent') AS tr,
              count(*) FILTER (WHERE kind = 'mixed') AS mx,
              count(*) FILTER (WHERE kind = 'shielded') AS sh,
              COALESCE(sum(fee_zat) FILTER (WHERE kind <> 'coinbase'), 0) AS fees,
              count(*) FILTER (WHERE kind <> 'coinbase' AND fee_zat IS NULL) AS unknown,
              COALESCE(sum(sapling_value_balance_zat), 0) AS sa,
              COALESCE(sum(orchard_value_balance_zat), 0) AS oc
         FROM tx GROUP BY block_height
     )
     SELECT b.height FROM block b LEFT JOIN t ON t.h = b.height
      WHERE COALESCE(t.n, 0) <> b.tx_count
         OR COALESCE(t.tr, 0) <> b.transparent_tx_count
         OR COALESCE(t.mx, 0) <> b.mixed_tx_count
         OR COALESCE(t.sh, 0) <> b.shielded_tx_count
         OR (b.total_fee_zat IS NOT NULL AND (COALESCE(t.unknown, 0) > 0 OR COALESCE(t.fees, 0) <> b.total_fee_zat))
         OR COALESCE(t.sa, 0) <> b.sapling_flow_zat
         OR COALESCE(t.oc, 0) <> b.orchard_flow_zat
      ORDER BY b.height LIMIT ${EXAMPLES}`,
  );
  if (perBlock.rows.length > 0) {
    failures.push(
      `transactions disagree with their block at ${perBlock.rows.map((r) => r.height).join(", ")}`,
    );
  }

  // Exact integer arithmetic in SQL: the totals are near 2^53, past where a float is exact.
  const reconcile = await pool.query<{ height: number; residual: string | null; unset: string }>(
    `SELECT m.computed_height AS height,
            (b.transparent_pool_zat::numeric
               - (SELECT COALESCE(sum(balance_zat), 0) FROM chain_address_balance)
               - m.unattributed_zat)::text AS residual,
            (SELECT count(*) FROM chain_address_balance WHERE tx_count IS NULL)::text AS unset
       FROM chain_rich_list_meta m LEFT JOIN block b ON b.height = m.computed_height`,
  );
  const r = reconcile.rows[0];
  if (!r || r.height !== manifest.height) {
    failures.push(`the rich list stands at ${r?.height ?? "nothing"}, expected ${manifest.height}`);
  } else if (r.residual !== "0") {
    failures.push(
      `transparent pool at ${r.height} - (balances + unattributed) = ${r.residual ?? "unknown"} zat, expected 0`,
    );
  }
  if (r && r.unset !== "0") {
    failures.push(`${r.unset} rich-list addresses have no transaction count`);
  }

  const snapshot = manifest.snapshots.find((x) => x.path === "addresses.parquet");
  if (snapshot?.height === manifest.height) {
    const diff = await pool.query<{ missing: string; differ: string; extra: string }>(
      `SELECT count(*) FILTER (WHERE b.address IS NULL)::text AS missing,
              count(*) FILTER (WHERE b.address IS NOT NULL AND (s.balance_zat <> b.balance_zat
                 OR (s.tx_count IS NOT NULL AND s.tx_count <> b.tx_count)))::text AS differ,
              ((SELECT count(*) FROM chain_address_balance) - count(b.address))::text AS extra
         FROM ${ADDRESS_SNAPSHOT_TABLE} s LEFT JOIN chain_address_balance b USING (address)`,
    );
    const d = diff.rows[0]!;
    if (d.missing !== "0" || d.differ !== "0" || d.extra !== "0") {
      failures.push(
        `the rich list differs from the release's addresses: ${d.missing} missing, ${d.differ} different, ${d.extra} extra`,
      );
    }
  } else {
    failures.push(
      `the addresses snapshot stands at ${snapshot?.height ?? "no height"}, not ${manifest.height}`,
    );
  }
  return failures;
}
