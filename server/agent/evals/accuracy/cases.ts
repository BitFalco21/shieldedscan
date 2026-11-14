import { MINING_POOL_LABELS } from "@/domain/mining-pools";
import type { AccuracyCase } from "./types";

/**
 * The accuracy questions. Every period is closed (a past month or day, a block height, an all-time
 * record read before and after the turn), so the truth and Zeno's read cannot straddle a block.
 * Truth reads `opendata.*` only, through the read-only role; a query that scans `tx` by time is
 * not allowed here (a month of it took 17 s on the box), so transaction-level truths are per txid
 * or per block, and period truths read the day tables.
 *
 * Distractor columns are the figures a wrong answer is likely to state instead, so a WRONG names
 * the mistake. Days are text, `$n` parameters are bound, and nothing is spliced into the SQL.
 */

/** A month's edges as `YYYY-MM-DD`, half-open. */
const OCT = { from: "2026-10-01", to: "2026-11-01" };
const SEP = { from: "2026-09-01", to: "2026-10-01" };
const AUG = { from: "2026-08-01", to: "2026-09-01" };

/** A pool's reviewed payout addresses, from the site's own registry. */
function poolAddresses(pool: string): string[] {
  return Object.entries(MINING_POOL_LABELS)
    .filter(([, label]) => label.miningPool === pool)
    .map(([address]) => address);
}

/** Every reviewed address and its pool, as two parallel arrays for `unnest`. */
function registry(): [string[], string[]] {
  const entries = Object.entries(MINING_POOL_LABELS);
  return [entries.map(([a]) => a), entries.map(([, l]) => l.miningPool)];
}

const window = (w: { from: string; to: string }, groupBy?: string) => ({
  name: "chain_activity" as const,
  args: { mode: "window", from: w.from, to: w.to, ...(groupBy ? { groupBy } : {}) },
});

export const ACCURACY_CASES: AccuracyCase[] = [
  // ── transactions ────────────────────────────────────────────────────────────────────────
  {
    id: "tx-month-total",
    area: "transactions",
    question: "How many transactions were there on Zcash in October 2026?",
    variants: ["how many txns in october 2026"],
    independence: "same-rollup",
    truth: {
      sql: `SELECT sum(transparent + mixed + shielded)::bigint AS n,
                   (SELECT sum(transparent + mixed + shielded) FROM opendata.check_day_rollup
                     WHERE day >= '${SEP.from}' AND day < '${SEP.to}')::bigint AS n_previous_month,
                   (SELECT sum(blocks) FROM opendata.check_mining_day
                     WHERE day >= '${OCT.from}' AND day < '${OCT.to}')::bigint AS coinbase
              FROM opendata.check_day_rollup WHERE day >= '${OCT.from}' AND day < '${OCT.to}'`,
      derive: (row) => ({
        ...row,
        n_with_coinbase: Number(row.n) + Number(row.coinbase),
      }),
    },
    expect: {
      unit: "count",
      column: "n",
      anchor: /transactions?|txns?/i,
      distractors: ["n_previous_month", "n_with_coinbase", "coinbase"],
    },
    route: [window(OCT)],
  },
  {
    id: "tx-fully-shielded-through",
    area: "transactions",
    question: "How many fully shielded transactions had Zcash recorded by the end of October 2026?",
    independence: "same-rollup",
    truth: {
      sql: `SELECT sum(shielded) FILTER (WHERE day < '${OCT.to}')::bigint AS n,
                   sum(shielded)::bigint AS n_to_today,
                   sum(shielded) FILTER (WHERE day >= '${OCT.from}' AND day < '${OCT.to}')::bigint
                     AS n_october
              FROM opendata.check_day_rollup`,
    },
    expect: {
      unit: "count",
      column: "n",
      anchor: /shielded/i,
      distractors: ["n_to_today", "n_october"],
    },
  },
  {
    id: "tx-shielding-count",
    area: "shielding",
    question: "How many shielding transactions were there in September 2026?",
    independence: "same-rollup",
    truth: {
      sql: `SELECT sum(shielding_txs)::bigint AS n, sum(unshielding_txs)::bigint AS n_unshielding
              FROM opendata.shielding_daily WHERE day >= '${SEP.from}' AND day < '${SEP.to}'`,
    },
    expect: { unit: "count", column: "n", anchor: /shielding/i, distractors: ["n_unshielding"] },
    route: [window(SEP)],
  },
  {
    id: "tx-unshielding-count",
    area: "shielding",
    question: "How many unshielding transactions were there in September 2026?",
    independence: "same-rollup",
    truth: {
      sql: `SELECT sum(unshielding_txs)::bigint AS n, sum(shielding_txs)::bigint AS n_shielding
              FROM opendata.shielding_daily WHERE day >= '${SEP.from}' AND day < '${SEP.to}'`,
    },
    expect: { unit: "count", column: "n", anchor: /unshielding/i, distractors: ["n_shielding"] },
    route: [window(SEP)],
  },
  {
    id: "shielding-busiest-day",
    area: "shielding",
    question: "Which day in 2024 had the most shielding transactions?",
    independence: "same-rollup",
    truth: {
      sql: `WITH d AS (SELECT day, shielding_txs AS n FROM opendata.shielding_daily
                        WHERE day >= '2024-01-01' AND day < '2025-01-01'),
                 v AS (SELECT day, shielded_zat FROM opendata.shielding_flow_daily
                        WHERE day >= '2024-01-01' AND day < '2025-01-01')
            SELECT to_char((SELECT day FROM d ORDER BY n DESC, day LIMIT 1), 'YYYY-MM-DD') AS day,
                   to_char((SELECT day FROM v ORDER BY shielded_zat DESC, day LIMIT 1), 'YYYY-MM-DD')
                     AS volume_day,
                   (SELECT count(*) FROM d WHERE n = (SELECT max(n) FROM d))::int AS ties`,
    },
    expect: {
      unit: "day",
      column: "day",
      anchor: /most|busiest|highest|peak|top|record/i,
      distractors: ["volume_day"],
    },
  },

  // ── pools ───────────────────────────────────────────────────────────────────────────────
  {
    id: "pool-orchard-month",
    area: "pools",
    question: "How many transactions used the Orchard pool in October 2026?",
    variants: ["how many txns in orchard pool in october 2026"],
    independence: "same-rollup",
    truth: {
      sql: `SELECT sum(txs) FILTER (WHERE pool = 'orchard')::bigint AS n,
                   sum(txs) FILTER (WHERE pool = 'ironwood')::bigint AS n_ironwood,
                   sum(txs) FILTER (WHERE pool = 'sapling')::bigint AS n_sapling
              FROM opendata.check_day_pool_tx WHERE day >= '${OCT.from}' AND day < '${OCT.to}'`,
    },
    expect: {
      unit: "count",
      column: "n",
      anchor: /orchard/i,
      distractors: ["n_ironwood", "n_sapling"],
    },
  },
  {
    id: "pool-migration-orchard-ironwood",
    area: "pools",
    question: "How many transactions migrated value from Orchard to Ironwood in October 2026?",
    independence: "same-rollup",
    truth: {
      sql: `SELECT sum(txs) FILTER (WHERE day >= '${OCT.from}' AND day < '${OCT.to}')::bigint AS n,
                   sum(txs)::bigint AS n_all_time
              FROM opendata.pool_migration_daily
             WHERE source = 'orchard' AND destination = 'ironwood'`,
    },
    expect: {
      unit: "count",
      column: "n",
      anchor: /migrat|orchard|ironwood/i,
      distractors: ["n_all_time"],
    },
  },

  // ── supply ──────────────────────────────────────────────────────────────────────────────
  {
    id: "supply-sapling-at-day",
    area: "supply",
    question: "How much ZEC was in the Sapling pool at the end of June 30, 2026?",
    independence: "same-rollup",
    truth: {
      sql: `SELECT sapling_pool_zat AS zat,
                   (SELECT sapling_pool_zat FROM opendata.check_day_supply_close
                     ORDER BY day DESC LIMIT 1) AS zat_latest,
                   orchard_pool_zat AS zat_orchard
              FROM opendata.check_day_supply_close WHERE day = '2026-06-30'`,
    },
    expect: {
      unit: "zec",
      column: "zat",
      anchor: /sapling/i,
      distractors: ["zat_latest", "zat_orchard"],
    },
  },
  {
    id: "supply-orchard-at-day",
    area: "supply",
    question: "What was the Orchard pool's balance at the end of 2025-12-31?",
    independence: "same-rollup",
    truth: {
      sql: `SELECT orchard_pool_zat AS zat, sapling_pool_zat AS zat_sapling,
                   (SELECT orchard_pool_zat FROM opendata.check_day_supply_close
                     ORDER BY day DESC LIMIT 1) AS zat_latest
              FROM opendata.check_day_supply_close WHERE day = '2025-12-31'`,
    },
    expect: {
      unit: "zec",
      column: "zat",
      anchor: /orchard|balance/i,
      distractors: ["zat_latest", "zat_sapling"],
    },
  },

  // ── shielding amounts ───────────────────────────────────────────────────────────────────
  {
    id: "shielding-zec-month",
    area: "shielding",
    question: "How much ZEC was shielded in August 2026?",
    independence: "same-rollup",
    truth: {
      sql: `SELECT sum(shielded_zat)::bigint AS zat, sum(unshielded_zat)::bigint AS zat_unshielded
              FROM opendata.shielding_flow_daily WHERE day >= '${AUG.from}' AND day < '${AUG.to}'`,
    },
    expect: {
      unit: "zec",
      column: "zat",
      anchor: /shielded|shielding|into/i,
      distractors: ["zat_unshielded"],
    },
  },
  {
    id: "unshielding-zec-month",
    area: "shielding",
    question: "How much ZEC was unshielded in August 2026?",
    independence: "same-rollup",
    truth: {
      sql: `SELECT sum(unshielded_zat)::bigint AS zat, sum(shielded_zat)::bigint AS zat_shielded
              FROM opendata.shielding_flow_daily WHERE day >= '${AUG.from}' AND day < '${AUG.to}'`,
    },
    expect: {
      unit: "zec",
      column: "zat",
      anchor: /unshield|out of/i,
      distractors: ["zat_shielded"],
    },
  },

  // ── fees ────────────────────────────────────────────────────────────────────────────────
  {
    id: "fees-month-total",
    area: "fees",
    question: "How much did Zcash users pay in fees in October 2026?",
    independence: "base",
    truth: {
      sql: `SELECT sum(total_fee_zat)::bigint AS zat, count(*)::int AS blocks,
                   count(total_fee_zat)::int AS covered
              FROM opendata.blocks
             WHERE timestamp >= extract(epoch FROM timestamp '${OCT.from}')
               AND timestamp < extract(epoch FROM timestamp '${OCT.to}')`,
    },
    expect: { unit: "zec", column: "zat", anchor: /fee/i },
    route: [window(OCT)],
  },
  {
    id: "fees-median-shielded",
    area: "fees",
    question: "What was the median fee of a fully shielded transaction in September 2026?",
    independence: "same-rollup",
    truth: {
      sql: `SELECT median_zat AS zat,
                   (SELECT median_zat FROM opendata.fees_monthly
                     WHERE month = '${SEP.from}' AND kind = 'transparent') AS zat_transparent
              FROM opendata.fees_monthly WHERE month = '${SEP.from}' AND kind = 'shielded'`,
    },
    expect: { unit: "zec", column: "zat", anchor: /median|fee/i, distractors: ["zat_transparent"] },
  },

  // ── blocks and transactions by id ───────────────────────────────────────────────────────
  {
    id: "block-tx-count",
    area: "blocks",
    question: "How many transactions are in block 3,133,528?",
    independence: "base",
    truth: {
      sql: `SELECT tx_count AS n,
                   (transparent_tx_count + mixed_tx_count + shielded_tx_count) AS n_without_coinbase
              FROM opendata.blocks WHERE height = 3133528`,
    },
    expect: {
      unit: "count",
      column: "n",
      anchor: /transactions?/i,
      distractors: ["n_without_coinbase"],
    },
    route: [{ name: "lookup_block", args: { heightOrHash: "3133528" } }],
  },
  {
    id: "block-fees",
    area: "blocks",
    question: "What were the total fees in block 3,133,528?",
    independence: "base",
    truth: {
      sql: `SELECT total_fee_zat AS zat FROM opendata.blocks WHERE height = 3133528`,
    },
    expect: { unit: "zec", column: "zat", anchor: /fee/i },
    route: [{ name: "lookup_block", args: { heightOrHash: "3133528" } }],
  },
  {
    id: "tx-wide-inputs",
    area: "transactions",
    question:
      "How many transparent inputs does transaction c860a7e881d9291ab464fc52ec9213f69d071cc1cc540ea84fd05679b5bae6ed have?",
    independence: "base",
    truth: {
      sql: `SELECT count(*) FILTER (WHERE io = 'in')::int AS n,
                   count(*) FILTER (WHERE io = 'out')::int AS n_outputs,
                   1000 AS api_page_cap
              FROM opendata.transparent_io
             WHERE txid = 'c860a7e881d9291ab464fc52ec9213f69d071cc1cc540ea84fd05679b5bae6ed'`,
    },
    expect: {
      unit: "count",
      column: "n",
      anchor: /inputs?/i,
      distractors: ["n_outputs", "api_page_cap"],
    },
    route: [
      {
        name: "lookup_transaction",
        args: { txid: "c860a7e881d9291ab464fc52ec9213f69d071cc1cc540ea84fd05679b5bae6ed" },
      },
    ],
  },
  {
    id: "tx-shielded-amount",
    area: "transactions",
    question:
      "How much ZEC did transaction cff333b87f391fbb40c2e2ad4352b61265c9f3ac7356f39f2dd8d9515d7bf561 send?",
    independence: "base",
    truth: {
      sql: `SELECT kind, fee_zat FROM opendata.transactions
             WHERE txid = 'cff333b87f391fbb40c2e2ad4352b61265c9f3ac7356f39f2dd8d9515d7bf561'`,
    },
    expect: { unit: "unmeasured", column: "kind", anchor: /ZEC|zatoshi/i },
    route: [
      {
        name: "lookup_transaction",
        args: { txid: "cff333b87f391fbb40c2e2ad4352b61265c9f3ac7356f39f2dd8d9515d7bf561" },
      },
    ],
  },

  // ── mining ──────────────────────────────────────────────────────────────────────────────
  {
    id: "mining-blocks-month",
    area: "mining",
    question: "How many blocks were mined in October 2026?",
    independence: "base",
    truth: {
      sql: `SELECT count(*)::int AS n FROM opendata.blocks
             WHERE timestamp >= extract(epoch FROM timestamp '${OCT.from}')
               AND timestamp < extract(epoch FROM timestamp '${OCT.to}')`,
    },
    expect: { unit: "count", column: "n", anchor: /blocks?/i },
    route: [window(OCT)],
  },
  {
    id: "mining-viabtc-share",
    area: "mining",
    question: "What share of October 2026's blocks did ViaBTC mine?",
    variants: ["viabtc % of blocks in october 2026?"],
    independence: "base",
    truth: {
      sql: `SELECT count(*) FILTER (WHERE miner_address = ANY($1))::int AS pool_blocks,
                   count(*)::int AS blocks,
                   count(*) FILTER (WHERE miner_address = ANY($2))::int AS reviewed_blocks
              FROM opendata.block_miners
             WHERE timestamp >= extract(epoch FROM timestamp '${OCT.from}')
               AND timestamp < extract(epoch FROM timestamp '${OCT.to}')`,
      params: () => [poolAddresses("viabtc"), registry()[0]],
      derive: (row) => ({
        ...row,
        pct: (100 * Number(row.pool_blocks)) / Number(row.blocks),
        pct_of_reviewed: (100 * Number(row.pool_blocks)) / Number(row.reviewed_blocks),
      }),
    },
    expect: { unit: "pct", column: "pct", anchor: /viabtc/i, distractors: ["pct_of_reviewed"] },
  },
  {
    id: "mining-viabtc-blocks",
    area: "mining",
    question: "How many blocks did ViaBTC mine in October 2026?",
    independence: "base",
    truth: {
      sql: `SELECT count(*) FILTER (WHERE miner_address = ANY($1))::int AS n
              FROM opendata.block_miners
             WHERE timestamp >= extract(epoch FROM timestamp '${OCT.from}')
               AND timestamp < extract(epoch FROM timestamp '${OCT.to}')`,
      params: () => [poolAddresses("viabtc")],
    },
    expect: { unit: "count", column: "n", anchor: /viabtc/i },
  },
  {
    id: "mining-pools-to-majority",
    area: "mining",
    question: "How many mining pools together mined a majority of blocks in October 2026?",
    independence: "base",
    truth: {
      sql: `WITH reg AS (SELECT * FROM unnest($1::text[], $2::text[]) AS r(address, pool)),
                 m AS (SELECT miner_address FROM opendata.block_miners
                        WHERE timestamp >= extract(epoch FROM timestamp '${OCT.from}')
                          AND timestamp < extract(epoch FROM timestamp '${OCT.to}')),
                 total AS (SELECT count(*) AS n FROM m),
                 per AS (SELECT reg.pool, count(*) AS n FROM m JOIN reg ON reg.address = m.miner_address
                          GROUP BY reg.pool),
                 run AS (SELECT n, sum(n) OVER (ORDER BY n DESC, pool) AS running,
                                row_number() OVER (ORDER BY n DESC, pool) AS k FROM per)
            SELECT (SELECT min(k) FROM run, total WHERE 100 * running >= 51 * total.n)::int AS n`,
      params: () => registry(),
    },
    expect: { unit: "count", column: "n", anchor: /pools?/i },
  },

  // ── records ─────────────────────────────────────────────────────────────────────────────
  {
    id: "record-largest-shielding",
    area: "records",
    question: "What is the largest single shielding transaction ever on Zcash, in ZEC?",
    independence: "same-rollup",
    truth: {
      sql: `SELECT max(max_shielding_zat)::bigint AS zat,
                   max(max_unshielding_zat)::bigint AS zat_unshielding
              FROM opendata.shielding_records_daily`,
    },
    expect: {
      unit: "zec",
      column: "zat",
      anchor: /shield|largest|ZEC/i,
      distractors: ["zat_unshielding"],
    },
    route: [{ name: "chain_status", args: { include: ["records"] } }],
  },
  {
    id: "record-largest-unshielding",
    area: "records",
    question: "What is the largest single unshielding transaction ever on Zcash, in ZEC?",
    independence: "same-rollup",
    truth: {
      sql: `SELECT max(max_unshielding_zat)::bigint AS zat,
                   max(max_shielding_zat)::bigint AS zat_shielding
              FROM opendata.shielding_records_daily`,
    },
    expect: {
      unit: "zec",
      column: "zat",
      anchor: /unshield|largest|ZEC/i,
      distractors: ["zat_shielding"],
    },
    route: [{ name: "chain_status", args: { include: ["records"] } }],
  },
  {
    id: "transparent-active-addresses",
    area: "transactions",
    question: "How many active transparent addresses were there in October 2026?",
    independence: "same-rollup",
    truth: {
      sql: `SELECT (SELECT active_addresses FROM opendata.transparent_monthly
                     WHERE month = '${OCT.from}') AS n,
                   (SELECT sum(active_addresses) FROM opendata.transparent_daily
                     WHERE day >= '${OCT.from}' AND day < '${OCT.to}')::bigint AS n_summed_days`,
    },
    expect: {
      unit: "count",
      column: "n",
      anchor: /active|addresses/i,
      distractors: ["n_summed_days"],
    },
  },
];
