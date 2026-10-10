import { readFileSync } from "node:fs";
import { Pool } from "pg";
import {
  type CrossChainAggregate,
  type CrossChainDirection,
  type CrossChainFlowSummary,
  type CrossChainGroup,
  type CrossChainGroupBy,
  type CrossChainNarrowing,
  type CrossChainProtocol,
  type CrossChainTopBasis,
  type CrossChainTopOrder,
  type CrossChainTransfer,
  type ZcashTxCrossings,
  type CrossChainVolumeSide,
  SETTLEMENT_ASSETS,
  ZCASH_CHAIN,
  classifyZcashAddress,
  groupOrder,
} from "@/domain";
import type { CursorPage, CursorQuery } from "@/data/source";
import { encodeCursor, INT8_SORT_KEY_MAX, seekFromCursors } from "@/data/cursor";
import {
  VENUE_STALE_AFTER_SECONDS,
  type ListOptions,
  type VenueHealth,
} from "@/data/crosschain/store";
import type {
  ChainInflowPoint,
  ChainOutflowPoint,
  CrossChainVolumePoint,
  CrossChainVolumeSeries,
  InflowKindMonthPoint,
  VenueMonthPoint,
  ZcashAddressKind,
} from "@/domain";
import type {
  AddressKindBucket,
  CrossChainEdgeRow,
  CrossChainStorePort,
  CrossChainVolume,
} from "./crosschain-store";
import { createPool } from "./pg-pool";
import { keysetSlice } from "./keyset-page";
import { clampPageSize, MAX_PAGE_SIZE } from "./page-size";
import "./pg-types";

/**
 * The WHERE clauses for a narrowing, pushing bind parameters onto `params`.
 *
 * One builder for both `list` and `countFiltered`, so the totals line and the list it describes
 * always count the same rows.
 *
 * Zcash is at exactly one end of every row, so "source" is `counterpart_chain` on an inbound
 * transfer and Zcash on an outbound one:
 *
 *     (direction = 'in' AND counterpart_chain = ANY($foreign))  OR  (direction = 'out')
 *
 * with the second arm present only when ZEC was picked and the first only when at least one
 * foreign chain was. Written as an explicit OR rather than
 * `CASE WHEN direction = 'in' THEN counterpart_chain ELSE 'ZEC' END = ANY($all)`, which wraps the
 * column in an expression and is unsargable. Neither arm present means "every chain".
 *
 * Exported for a structural test: every value pushed into `params` must be referenced by a `$N`
 * placeholder. A lost `$` (`usd_value_at_swap >= 2`) is still valid SQL, so only that test or a
 * bind-count mismatch can catch it.
 */
export function narrowingClauses(options: ListOptions, params: unknown[]): string[] {
  const clauses: string[] = [];
  if (!options.includeProtocolLegs) {
    params.push(SETTLEMENT_ASSETS);
    clauses.push(`counterpart_asset <> ALL($${params.length})`);
  }
  if (options.protocol && options.protocol !== "all") {
    params.push(options.protocol);
    clauses.push(`protocol = $${params.length}`);
  }
  if (options.direction && options.direction !== "all") {
    params.push(options.direction);
    clauses.push(`direction = $${params.length}`);
  }
  const side = (chains: readonly string[] | undefined, counterpartWhen: CrossChainDirection) => {
    if (!chains || chains.length === 0) return;
    const foreign = chains.filter((c) => c !== ZCASH_CHAIN);
    const arms: string[] = [];
    if (foreign.length > 0) {
      params.push(counterpartWhen, foreign);
      arms.push(
        `(direction = $${params.length - 1} AND counterpart_chain = ANY($${params.length}))`,
      );
    }
    // Zcash sits on this side of every outbound transfer, so no chain comparison is needed (and
    // `counterpart_chain` is never 'ZEC').
    if (foreign.length !== chains.length) {
      params.push(counterpartWhen === "in" ? "out" : "in");
      arms.push(`direction = $${params.length}`);
    }
    clauses.push(arms.length === 1 ? (arms[0] as string) : `(${arms.join(" OR ")})`);
  };
  side(options.sourceChains, "in");
  side(options.destinationChains, "out");
  // Direction-blind and a plain `= ANY` on the column, so it stays sargable: the filter a caller
  // naming one chain wants, where the two directional ones above would AND to the empty set.
  if (options.counterpartChains && options.counterpartChains.length > 0) {
    params.push(options.counterpartChains);
    clauses.push(`counterpart_chain = ANY($${params.length})`);
  }
  if (options.minUsdAtSwap !== undefined) {
    params.push(options.minUsdAtSwap);
    // `>=` on a nullable column excludes NULL by SQL's three-valued logic, as wanted: a transfer of
    // unknown value must not appear in a list that claims everything in it exceeds a number.
    clauses.push(`usd_value_at_swap >= $${params.length}`);
  }
  // The chain's own amount: NOT NULL, so unlike the USD floor this excludes nothing for want of a
  // price. Mirrors `matchesCrossChainFilters`.
  if (options.minZecZat !== undefined) {
    params.push(options.minZecZat);
    clauses.push(`zec_amount_zat >= $${params.length}`);
  }
  // Mirrors `matchesCrossChainFilters`: only rows the venue reports as completed.
  if (options.completedOnly === true) {
    clauses.push(`status = 'completed'`);
  }
  // Half-open, matching `matchesCrossChainFilters`: `>=` on the lower edge and `<` on the upper,
  // so a calendar month counts its own midnight once and the next month's not at all.
  if (options.fromTimestamp !== undefined) {
    params.push(options.fromTimestamp);
    clauses.push(`timestamp >= $${params.length}`);
  }
  if (options.toTimestamp !== undefined) {
    params.push(options.toTimestamp);
    clauses.push(`timestamp < $${params.length}`);
  }
  return clauses;
}

/** One row of the narrowed aggregate, as Postgres returns it (bigints arrive as strings). */
interface AggregateRow {
  key: string;
  in_transfers: string;
  in_zec: string;
  in_usd: string;
  in_usd_covered: string;
  out_transfers: string;
  out_zec: string;
  out_usd: string;
  out_usd_covered: string;
  first_at: string | null;
  last_at: string | null;
}

/**
 * The SQL expression each grouping axis keys on, or null for "no grouping".
 *
 * A switch over the union rather than an interpolated column name, so no caller-supplied string
 * can become SQL.
 *
 * Period keys are formatted AT TIME ZONE 'UTC' explicitly. The domain builds its key from
 * `toISOString()`, which is UTC, so a server in another timezone would otherwise file a midnight
 * transfer under a different month than the in-memory path does.
 */
/**
 * The UTC start of a transfer's month or day, in unix seconds. `AT TIME ZONE 'UTC'` makes the
 * bucket independent of the session's time zone, so a period starts where the client's
 * `Date.UTC` says it does and a late-evening transfer stays in its own UTC month.
 */
function utcBucketEpoch(unit: "month" | "day"): string {
  return `EXTRACT(EPOCH FROM date_trunc('${unit}', to_timestamp(timestamp) AT TIME ZONE 'UTC'))::bigint`;
}

function groupKeyExpression(groupBy: CrossChainGroupBy): string | null {
  switch (groupBy) {
    case "none":
      return null;
    case "chain":
      return "counterpart_chain";
    case "venue":
      return "protocol";
    case "month":
      return "to_char(to_timestamp(timestamp) AT TIME ZONE 'UTC', 'YYYY-MM')";
    case "day":
      return "to_char(to_timestamp(timestamp) AT TIME ZONE 'UTC', 'YYYY-MM-DD')";
  }
}

const emptyAggregateSide = (): CrossChainVolumeSide => ({
  transfers: 0,
  zecAmountZat: 0,
  usdAtSwap: 0,
  usdCoveredTransfers: 0,
});

/** Fold one group's side into a running total. */
function addSides(total: CrossChainVolumeSide, side: CrossChainVolumeSide): void {
  total.transfers += side.transfers;
  total.zecAmountZat += side.zecAmountZat;
  total.usdAtSwap += side.usdAtSwap;
  total.usdCoveredTransfers += side.usdCoveredTransfers;
}

interface VolumeSeriesRow {
  ts: string;
  in_zat: string;
  out_zat: string;
  transfers: number;
  in_transfers: number;
  out_transfers: number;
  /** DOUBLE PRECISION, so `pg` hands it back as a JS number rather than a string. */
  in_usd: number;
  out_usd: number;
  in_usd_covered: number;
  out_usd_covered: number;
}

interface TransferRow {
  id: string;
  protocol: string;
  direction: string;
  status: string;
  timestamp: number;
  counterpart_chain: string;
  counterpart_asset: string;
  counterpart_amount: number | null;
  counterpart_tx_hash: string | null;
  counterpart_is_synthetic: boolean;
  counterpart_address: string | null;
  counterpart_usd_at_swap: number | null;
  venue_deposit_address: string | null;
  zcash_txid: string | null;
  zcash_address: string | null;
  zec_amount_zat: number;
  usd_value_at_swap: number | null;
}

function toTransfer(row: TransferRow): CrossChainTransfer {
  return {
    id: row.id,
    protocol: row.protocol as CrossChainTransfer["protocol"],
    direction: row.direction as CrossChainTransfer["direction"],
    status: row.status as CrossChainTransfer["status"],
    timestamp: row.timestamp,
    counterpartChain: row.counterpart_chain,
    counterpartAsset: row.counterpart_asset,
    counterpartAmount: row.counterpart_amount,
    counterpartTxHash: row.counterpart_tx_hash,
    counterpartIsSynthetic: row.counterpart_is_synthetic,
    counterpartAddress: row.counterpart_address,
    counterpartUsdAtSwap: row.counterpart_usd_at_swap,
    venueDepositAddress: row.venue_deposit_address,
    zcashTxid: row.zcash_txid,
    zcashAddress: row.zcash_address,
    zecAmountZat: row.zec_amount_zat,
    usdValueAtSwap: row.usd_value_at_swap,
  };
}

const SELECT_COLUMNS = `id, protocol, direction, status, timestamp, counterpart_chain,
  counterpart_asset, counterpart_amount, counterpart_tx_hash, counterpart_address,
  counterpart_is_synthetic, counterpart_usd_at_swap, venue_deposit_address,
  zcash_txid, zcash_address, zec_amount_zat, usd_value_at_swap`;

export class PostgresStorePort implements CrossChainStorePort {
  readonly #pool: Pool;

  /**
   * With no connection string, falls back to the standard `PGHOST`/`PGUSER`/`PGPASSWORD`/
   * `PGDATABASE` variables, the preferred way in: a URL must percent-encode the password, and a
   * generated password containing `/`, `@`, `#` or `:` can parse into the wrong host.
   */
  constructor(connectionString?: string) {
    // One long-lived pool for the process: serverless callers would otherwise exhaust Postgres
    // connections. A statement_timeout, as on the analytics pool: an unbounded query on a shared
    // pool denies service to every other caller. The venue poller's upserts run here too and finish
    // far inside this bound.
    const opts = { max: 8, statement_timeout: 30_000 };
    this.#pool = createPool(connectionString, opts);
  }

  /** Idempotent DDL, applied on boot so a fresh box needs no manual migration step. */
  async migrate(schemaPath: string): Promise<void> {
    await this.#pool.query(readFileSync(schemaPath, "utf8"));
  }

  /**
   * Upsert on the venue-assigned id.
   *
   * One statement for the whole batch: a venue republishes a swap as it settles, so re-ingesting
   * must update rather than duplicate or fail. `xmax = 0` identifies genuinely new rows (zero for
   * an insert, non-zero for an update), which the poller logs as `new=`.
   */
  async upsert(transfers: readonly CrossChainTransfer[]): Promise<number> {
    if (transfers.length === 0) return 0;
    const now = Math.floor(Date.now() / 1000);

    const values: unknown[] = [];
    const tuples = transfers.map((t) => {
      const row = [
        t.id,
        t.protocol,
        t.direction,
        t.status,
        t.timestamp,
        t.counterpartChain,
        t.counterpartAsset,
        t.counterpartAmount,
        t.counterpartTxHash,
        t.counterpartAddress,
        t.counterpartIsSynthetic,
        t.zcashTxid,
        t.zcashAddress,
        // Derived here, by the same classifier the UI uses — never by a SQL regex.
        classifyZcashAddress(t.zcashAddress),
        t.zecAmountZat,
        t.usdValueAtSwap,
        t.counterpartUsdAtSwap,
        t.venueDepositAddress,
        now,
      ];
      const placeholders = row.map((_, j) => `$${values.length + j + 1}`);
      values.push(...row);
      // `now` is bound once and fills both `first_seen_at` and `updated_at`.
      return `(${[...placeholders, placeholders[placeholders.length - 1]].join(",")})`;
    });

    const { rows } = await this.#pool.query<{ inserted: boolean }>(
      `INSERT INTO crosschain_transfer (
         id, protocol, direction, status, timestamp, counterpart_chain, counterpart_asset,
         counterpart_amount, counterpart_tx_hash, counterpart_address,
         counterpart_is_synthetic, zcash_txid,
         zcash_address, zcash_address_kind, zec_amount_zat, usd_value_at_swap,
         counterpart_usd_at_swap, venue_deposit_address, first_seen_at, updated_at
       ) VALUES ${tuples.join(",")}
       ON CONFLICT (id) DO UPDATE SET
         protocol = EXCLUDED.protocol,
         direction = EXCLUDED.direction,
         status = EXCLUDED.status,
         timestamp = EXCLUDED.timestamp,
         counterpart_chain = EXCLUDED.counterpart_chain,
         counterpart_asset = EXCLUDED.counterpart_asset,
         counterpart_amount = EXCLUDED.counterpart_amount,
         counterpart_tx_hash = EXCLUDED.counterpart_tx_hash,
         counterpart_address = EXCLUDED.counterpart_address,
         counterpart_is_synthetic = EXCLUDED.counterpart_is_synthetic,
         zcash_txid = EXCLUDED.zcash_txid,
         zcash_address = EXCLUDED.zcash_address,
         zcash_address_kind = EXCLUDED.zcash_address_kind,
         zec_amount_zat = EXCLUDED.zec_amount_zat,
         usd_value_at_swap = EXCLUDED.usd_value_at_swap,
         counterpart_usd_at_swap = EXCLUDED.counterpart_usd_at_swap,
         venue_deposit_address = EXCLUDED.venue_deposit_address,
         updated_at = EXCLUDED.updated_at
       RETURNING (xmax = 0) AS inserted`,
      values,
    );
    return rows.filter((r) => r.inserted).length;
  }

  /**
   * Flow per chain and direction, in one GROUP BY.
   *
   * `counterpart_asset <> ALL(...)` mirrors the list's settlement-leg rule: filtered by asset,
   * never by chain, because wrapped ZEC lives on MAYA too and a chain filter would drop every
   * ZEC→wrapped-ZEC crossing.
   *
   * The window anchors on `now()`, like `volumeSeries`. Anchoring on the table's own
   * `max(timestamp)` would slide the window back to meet the last row and hide a venue outage,
   * where a clock-anchored window shows the gap and `firstAt`/`lastAt` report what was counted.
   */
  async flows(windowDays: number | null = null): Promise<CrossChainFlowSummary> {
    /*
     * One scan covering both windows: the previous window's totals ride along as `FILTER`
     * aggregates over the same rows, so the comparison cannot straddle two different `now()`
     * values. The outer bound is the previous window's start, which is why `$3`, not `$2`, bounds
     * the WHERE.
     */
    const { rows } = await this.#pool.query<{
      chain: string;
      direction: string;
      transfers: string;
      zec: string;
      usd: string | null;
      usd_covered: string;
      prev_zec: string | null;
      first_at: string | null;
      last_at: string | null;
    }>(
      // `sum(usd_value_at_swap)` skips nulls and `count(usd_value_at_swap)` counts the rows that
      // had one, the same pair `volume()` uses, so per-chain figures and the all-time cards agree
      // about coverage. Both carry the window FILTER, or a windowed view would report all-time
      // dollars beside windowed ZEC.
      `WITH bounds AS (
         SELECT EXTRACT(EPOCH FROM now() - make_interval(days => $2::int))::bigint     AS cur_start,
                EXTRACT(EPOCH FROM now() - make_interval(days => 2 * $2::int))::bigint AS prev_start
       )
       SELECT counterpart_chain AS chain, direction,
              count(*)      FILTER (WHERE $2::int IS NULL OR timestamp >= b.cur_start) AS transfers,
              COALESCE(sum(zec_amount_zat)
                       FILTER (WHERE $2::int IS NULL OR timestamp >= b.cur_start), 0)  AS zec,
              sum(usd_value_at_swap)
                       FILTER (WHERE $2::int IS NULL OR timestamp >= b.cur_start)      AS usd,
              count(usd_value_at_swap)
                       FILTER (WHERE $2::int IS NULL OR timestamp >= b.cur_start)      AS usd_covered,
              sum(zec_amount_zat) FILTER (WHERE timestamp < b.cur_start)               AS prev_zec,
              min(timestamp) FILTER (WHERE $2::int IS NULL OR timestamp >= b.cur_start) AS first_at,
              max(timestamp) FILTER (WHERE $2::int IS NULL OR timestamp >= b.cur_start) AS last_at
         FROM crosschain_transfer, bounds b
        WHERE counterpart_asset <> ALL($1)
          AND ($2::int IS NULL OR timestamp >= b.prev_start)
        GROUP BY 1, 2`,
      [SETTLEMENT_ASSETS, windowDays],
    );

    // Rows exist for chains that moved ZEC only in the previous window; they carry a zero current
    // total and must not reach the diagram, which counts chains in its folded tail.
    const current = rows.filter((r) => Number(r.zec) > 0);
    const summary: CrossChainFlowSummary = {
      flows: current.map((r) => ({
        chain: r.chain,
        direction: r.direction as CrossChainTransfer["direction"],
        transfers: Number(r.transfers),
        zecAmountZat: Number(r.zec),
        usdAtSwap: Number(r.usd ?? 0),
        usdCoveredTransfers: Number(r.usd_covered),
      })),
      firstAt: current.reduce((m, r) => Math.min(m, Number(r.first_at)), Number.POSITIVE_INFINITY),
      lastAt: current.reduce((m, r) => Math.max(m, Number(r.last_at)), 0),
      windowDays,
      previous: { kind: "none" },
    };
    if (windowDays === null) return summary;

    /*
     * A comparison is refused unless the previous window lies entirely inside our records;
     * otherwise every chain would show growth that is only an artefact of when ingestion began. The
     * cheap `min()` here makes that checkable.
     */
    const { rows: coverage } = await this.#pool.query<{ begins_at: string | null; prev: string }>(
      `SELECT min(timestamp) AS begins_at,
              EXTRACT(EPOCH FROM now() - make_interval(days => 2 * $2::int))::bigint AS prev
         FROM crosschain_transfer
        WHERE counterpart_asset <> ALL($1)`,
      [SETTLEMENT_ASSETS, windowDays],
    );
    const beginsAt = Number(coverage[0]?.begins_at ?? 0);
    if (!coverage[0]?.begins_at || beginsAt > Number(coverage[0].prev)) {
      return { ...summary, previous: { kind: "incomplete", recordsBeginAt: beginsAt } };
    }
    return {
      ...summary,
      previous: {
        kind: "flows",
        flows: rows
          .filter((r) => r.prev_zec !== null && Number(r.prev_zec) > 0)
          .map((r) => ({
            chain: r.chain,
            direction: r.direction as CrossChainTransfer["direction"],
            // Only the ZEC total is compared, so the previous window's transfer count and dollars
            // are not carried. Zero here means "not measured for this row", never a claim.
            transfers: 0,
            zecAmountZat: Number(r.prev_zec),
            usdAtSwap: 0,
            usdCoveredTransfers: 0,
          })),
      },
    };
  }

  /**
   * Keyset page, as one composite range scan.
   *
   * `(timestamp, id) < ($ts, $id)` is a row-value comparison, which with the
   * `(timestamp DESC, id DESC)` index is a single seek at any depth, never OFFSET. The `after`
   * direction reverses the comparison and the sort, then flips the slice back, so paging backwards
   * is one seek too.
   */
  async list(
    query: CursorQuery,
    options: ListOptions = {},
  ): Promise<CursorPage<CrossChainTransfer>> {
    const limit = clampPageSize(query.limit);

    // A malformed or stale cursor resolves to the first page, never an error, including one whose
    // sort key is out of range for `crosschain_transfer.timestamp` (`BIGINT`).
    const seekAt = seekFromCursors(query, INT8_SORT_KEY_MAX);
    const seek = seekAt?.seek ?? null;
    const before = seekAt?.direction === "before";
    const after = seekAt?.direction === "after";

    // Every filter in SQL, so the LIMIT applies to matching rows. Applied after the query it
    // would return a short page and a cursor that skips whatever it removed.
    const params: unknown[] = [];
    const clauses = narrowingClauses(options, params);
    if (seek) {
      params.push(seek.sortKey, seek.id);
      const op = before ? "<" : ">";
      clauses.push(`(timestamp, id) ${op} ($${params.length - 1}, $${params.length})`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    // Paging backwards needs the nearest rows, so it scans ascending and is reversed
    // below; taking a DESC slice would return the oldest newer rows instead.
    const order = after ? "timestamp ASC, id ASC" : "timestamp DESC, id DESC";
    params.push(limit + 1);

    const { rows } = await this.#pool.query<TransferRow>(
      `SELECT ${SELECT_COLUMNS} FROM crosschain_transfer ${where}
       ORDER BY ${order} LIMIT $${params.length}`,
      params,
    );

    const page = keysetSlice(rows.map(toTransfer), limit, seekAt?.direction ?? null, (t) =>
      encodeCursor(t.timestamp, t.id),
    );
    return { items: page.rows, nextCursor: page.nextCursor, prevCursor: page.prevCursor };
  }

  async get(id: string): Promise<CrossChainTransfer | undefined> {
    const { rows } = await this.#pool.query<TransferRow>(
      `SELECT ${SELECT_COLUMNS} FROM crosschain_transfer WHERE id = $1`,
      [id],
    );
    const row = rows[0];
    return row ? toTransfer(row) : undefined;
  }

  /**
   * One seek on `crosschain_transfer_zcash_txid_idx`: a `/tx` page asks this on every view, so it
   * must never scan the table. Settlement legs are excluded, as on every list: a venue's internal
   * ZEC↔CACAO leg is not a crossing this site shows.
   */
  async byZcashTxid(txid: string, limit: number): Promise<ZcashTxCrossings> {
    // `count(*) OVER ()` is evaluated before LIMIT, so every row carries the total it was cut from:
    // one query, one instant.
    const { rows } = await this.#pool.query<TransferRow & { total: string }>(
      `SELECT ${SELECT_COLUMNS}, count(*) OVER () AS total FROM crosschain_transfer
        WHERE zcash_txid = $1 AND counterpart_asset <> ALL($2)
        ORDER BY timestamp DESC, id DESC
        LIMIT $3`,
      [txid, SETTLEMENT_ASSETS, limit],
    );
    return { transfers: rows.map(toTransfer), total: Number(rows[0]?.total ?? 0) };
  }

  /**
   * An estimate from the planner's statistics, not COUNT(*): this figure decorates /health, and a
   * full scan per health check is not worth it. Falls back to an exact count while the estimate is
   * missing or negative (before ANALYZE).
   */
  async count(): Promise<number> {
    const { rows } = await this.#pool.query<{ estimate: number }>(
      `SELECT reltuples::bigint AS estimate FROM pg_class WHERE relname = 'crosschain_transfer'`,
    );
    const estimate = rows[0]?.estimate ?? -1;
    if (estimate >= 0) return estimate;
    const exact = await this.#pool.query<{ n: number }>(
      `SELECT count(*)::bigint AS n FROM crosschain_transfer`,
    );
    return exact.rows[0]?.n ?? 0;
  }

  async countFiltered(options: ListOptions = {}): Promise<number> {
    /*
     * Exact, unlike count() above: the totals line quotes this as a fact, and the table counts in
     * milliseconds. Shares `narrowingClauses` with list(), so the two cannot disagree.
     */
    const params: unknown[] = [];
    const clauses = narrowingClauses(options, params);
    const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
    const { rows } = await this.#pool.query<{ n: number }>(
      `SELECT count(*)::bigint AS n FROM crosschain_transfer${where}`,
      params,
    );
    return rows[0]?.n ?? 0;
  }

  /**
   * A narrowed slice, totalled and grouped along one axis, in one GROUP BY.
   *
   * The SQL mirrors `aggregateCrossChain` in `domain/` by hand, and
   * `server/__tests__/crosschain-aggregate-parity.test.ts` holds the two to the same answers:
   *
   *  - the settlement-leg exclusion rides in `narrowingClauses`, by asset and never by chain;
   *  - `sum(usd_value_at_swap)` skips nulls while `count(usd_value_at_swap)` counts the rows that
   *    had one, so the dollars stay a floor with their coverage;
   *  - grouping by month or day uses `date_trunc` in UTC, matching the domain's
   *    `toISOString().slice(...)`.
   *
   * A slice that matches nothing returns zeroed totals and no groups: a measurement, which every
   * layer above must keep distinct from a failed read.
   */
  async aggregate(
    filters: CrossChainNarrowing,
    groupBy: CrossChainGroupBy,
  ): Promise<CrossChainAggregate> {
    const params: unknown[] = [];
    const clauses = narrowingClauses(filters, params);
    const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";

    // A fixed expression per axis, chosen by the enum and never interpolated from the caller.
    const keyExpr = groupKeyExpression(groupBy);
    const selectKey = keyExpr === null ? `''::text AS key` : `${keyExpr} AS key`;
    const groupClause = keyExpr === null ? "" : " GROUP BY 1";

    const { rows } = await this.#pool.query<AggregateRow>(
      `SELECT ${selectKey},
              count(*) FILTER (WHERE direction = 'in')                       AS in_transfers,
              COALESCE(sum(zec_amount_zat) FILTER (WHERE direction = 'in'), 0)
                                                                             AS in_zec,
              COALESCE(sum(usd_value_at_swap) FILTER (WHERE direction = 'in'), 0)
                                                                             AS in_usd,
              count(usd_value_at_swap) FILTER (WHERE direction = 'in')       AS in_usd_covered,
              count(*) FILTER (WHERE direction = 'out')                      AS out_transfers,
              COALESCE(sum(zec_amount_zat) FILTER (WHERE direction = 'out'), 0)
                                                                             AS out_zec,
              COALESCE(sum(usd_value_at_swap) FILTER (WHERE direction = 'out'), 0)
                                                                             AS out_usd,
              count(usd_value_at_swap) FILTER (WHERE direction = 'out')      AS out_usd_covered,
              min(timestamp)                                                 AS first_at,
              max(timestamp)                                                 AS last_at
         FROM crosschain_transfer${where}${groupClause}`,
      params,
    );

    const totals: CrossChainVolume = {
      in: emptyAggregateSide(),
      out: emptyAggregateSide(),
    };
    const groups: CrossChainGroup[] = [];
    let firstAt = Number.POSITIVE_INFINITY;
    let lastAt = 0;
    for (const row of rows) {
      const side = (d: "in" | "out"): CrossChainVolumeSide => ({
        transfers: Number(row[`${d}_transfers`]),
        zecAmountZat: Number(row[`${d}_zec`]),
        usdAtSwap: Number(row[`${d}_usd`]),
        usdCoveredTransfers: Number(row[`${d}_usd_covered`]),
      });
      const inSide = side("in");
      const outSide = side("out");
      addSides(totals.in, inSide);
      addSides(totals.out, outSide);
      if (keyExpr !== null) groups.push({ key: row.key, in: inSide, out: outSide });
      if (row.first_at !== null) firstAt = Math.min(firstAt, Number(row.first_at));
      if (row.last_at !== null) lastAt = Math.max(lastAt, Number(row.last_at));
    }

    return {
      groupBy,
      totals,
      // Ordered in TypeScript so one `groupOrder` decides it for both stores: a time axis reads
      // chronologically, everything else largest-first.
      groups: groups.sort(groupOrder(groupBy)),
      applied: filters,
      firstAt: Number.isFinite(firstAt) ? firstAt : 0,
      lastAt,
    };
  }

  /**
   * The largest (or smallest) transfers in a slice.
   *
   * `by: "usd"` orders on a nullable column, so the population is narrowed to rows that carry a
   * price: `NOT NULL` is stated rather than relying on `NULLS LAST`, because a row of unknown value
   * must not be ranked at all.
   */
  async top(
    filters: CrossChainNarrowing,
    by: CrossChainTopBasis,
    limit: number,
    rank: CrossChainTopOrder = "largest",
  ): Promise<CrossChainTransfer[]> {
    const params: unknown[] = [];
    const clauses = narrowingClauses(filters, params);
    // Applied for both ends: an unpriced transfer is a value we do not know, not a small one.
    if (by === "usd") clauses.push("usd_value_at_swap IS NOT NULL");
    const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
    // `id` breaks ties so the same query returns the same page twice (equal amounts are common at
    // these venues). The tiebreak stays ASC at both ends: it makes the result deterministic and
    // orders nothing.
    const dir = rank === "largest" ? "DESC" : "ASC";
    const column = by === "zec" ? "zec_amount_zat" : "usd_value_at_swap";
    const order = `${column} ${dir}, id ASC`;
    params.push(Math.max(0, Math.min(limit, MAX_PAGE_SIZE)));
    const { rows } = await this.#pool.query<TransferRow>(
      `SELECT ${SELECT_COLUMNS} FROM crosschain_transfer${where}
       ORDER BY ${order} LIMIT $${params.length}`,
      params,
    );
    return rows.map(toTransfer);
  }

  async volume(): Promise<CrossChainVolume> {
    // One aggregate. `usd_value_at_swap` sums only where present, and the covered count rides along
    // so the caller can state the floor. Settlement legs are excluded: a CACAO or RUNE leg is a
    // venue settling its own accounts, not cross-chain ZEC volume.
    const { rows } = await this.#pool.query<{
      direction: "in" | "out";
      transfers: number;
      zat: number;
      usd: number | null;
      usd_covered: number;
    }>(
      `SELECT direction,
              count(*)::bigint AS transfers,
              COALESCE(SUM(zec_amount_zat), 0)::bigint AS zat,
              SUM(usd_value_at_swap) AS usd,
              count(usd_value_at_swap)::bigint AS usd_covered
         FROM crosschain_transfer
        WHERE counterpart_asset <> ALL($1)
        GROUP BY direction`,
      [SETTLEMENT_ASSETS],
    );
    const empty = { transfers: 0, zecAmountZat: 0, usdAtSwap: 0, usdCoveredTransfers: 0 };
    const out: CrossChainVolume = { in: { ...empty }, out: { ...empty } };
    for (const r of rows) {
      out[r.direction] = {
        transfers: Number(r.transfers),
        zecAmountZat: Number(r.zat),
        usdAtSwap: Number(r.usd ?? 0),
        usdCoveredTransfers: Number(r.usd_covered),
      };
    }
    return out;
  }

  /**
   * ZEC crossing per month and per day, both grains in one response.
   *
   * The table groups in milliseconds, so no matview is needed. Same settlement-asset exclusion as
   * the list and the flows, so every figure on the page describes the same population.
   */
  async volumeSeries(): Promise<CrossChainVolumeSeries> {
    const bucket = (unit: "month" | "day", extraWhere: string) => `
      SELECT ${utcBucketEpoch(unit)} AS ts,
             COALESCE(SUM(zec_amount_zat) FILTER (WHERE direction = 'in'), 0)::bigint  AS in_zat,
             COALESCE(SUM(zec_amount_zat) FILTER (WHERE direction = 'out'), 0)::bigint AS out_zat,
             count(*)::int AS transfers,
             count(*) FILTER (WHERE direction = 'in')::int  AS in_transfers,
             count(*) FILTER (WHERE direction = 'out')::int AS out_transfers,
             COALESCE(SUM(usd_value_at_swap) FILTER (WHERE direction = 'in'), 0)  AS in_usd,
             COALESCE(SUM(usd_value_at_swap) FILTER (WHERE direction = 'out'), 0) AS out_usd,
             count(usd_value_at_swap) FILTER (WHERE direction = 'in')::int  AS in_usd_covered,
             count(usd_value_at_swap) FILTER (WHERE direction = 'out')::int AS out_usd_covered
        FROM crosschain_transfer
       WHERE counterpart_asset <> ALL($1)${extraWhere}
       GROUP BY 1 ORDER BY 1`;
    const [monthly, daily] = await Promise.all([
      this.#pool.query<VolumeSeriesRow>(bucket("month", ""), [SETTLEMENT_ASSETS]),
      this.#pool.query<VolumeSeriesRow>(
        // Trailing 366 days only: the longest range short of "all" is one year.
        bucket("day", ` AND timestamp >= EXTRACT(EPOCH FROM now() - interval '366 days')::bigint`),
        [SETTLEMENT_ASSETS],
      ),
    ]);
    const toPoint = (r: VolumeSeriesRow): CrossChainVolumePoint => ({
      timestamp: Number(r.ts),
      inZat: Number(r.in_zat),
      outZat: Number(r.out_zat),
      transfers: Number(r.transfers),
      inTransfers: Number(r.in_transfers),
      outTransfers: Number(r.out_transfers),
      inUsdAtSwap: Number(r.in_usd),
      outUsdAtSwap: Number(r.out_usd),
      inUsdCoveredTransfers: Number(r.in_usd_covered),
      outUsdCoveredTransfers: Number(r.out_usd_covered),
    });
    return { monthly: monthly.rows.map(toPoint), daily: daily.rows.map(toPoint) };
  }

  async inflowByChain(): Promise<ChainInflowPoint[]> {
    const { rows } = await this.#pool.query<{ ts: string; chain: string; in_zat: string }>(
      `SELECT ${utcBucketEpoch("month")} AS ts,
              counterpart_chain AS chain,
              SUM(zec_amount_zat)::bigint AS in_zat
         FROM crosschain_transfer
        WHERE direction = 'in' AND counterpart_asset <> ALL($1)
        GROUP BY 1, 2
        ORDER BY 1, 2`,
      [SETTLEMENT_ASSETS],
    );
    return rows.map((r) => ({ timestamp: Number(r.ts), chain: r.chain, inZat: Number(r.in_zat) }));
  }

  async outflowByChain(): Promise<ChainOutflowPoint[]> {
    const { rows } = await this.#pool.query<{ ts: string; chain: string; out_zat: string }>(
      `SELECT ${utcBucketEpoch("month")} AS ts,
              counterpart_chain AS chain,
              SUM(zec_amount_zat)::bigint AS out_zat
         FROM crosschain_transfer
        WHERE direction = 'out' AND counterpart_asset <> ALL($1)
        GROUP BY 1, 2
        ORDER BY 1, 2`,
      [SETTLEMENT_ASSETS],
    );
    return rows.map((r) => ({
      timestamp: Number(r.ts),
      chain: r.chain,
      outZat: Number(r.out_zat),
    }));
  }

  async volumeByVenue(): Promise<VenueMonthPoint[]> {
    const { rows } = await this.#pool.query<{
      ts: string;
      protocol: string;
      in_zat: string;
      out_zat: string;
    }>(
      `SELECT ${utcBucketEpoch("month")} AS ts,
              protocol,
              COALESCE(SUM(zec_amount_zat) FILTER (WHERE direction = 'in'), 0)::bigint AS in_zat,
              COALESCE(SUM(zec_amount_zat) FILTER (WHERE direction = 'out'), 0)::bigint AS out_zat
         FROM crosschain_transfer
        WHERE counterpart_asset <> ALL($1)
        GROUP BY 1, 2
        ORDER BY 1, 2`,
      [SETTLEMENT_ASSETS],
    );
    return rows.map((r) => ({
      timestamp: Number(r.ts),
      protocol: r.protocol,
      inZat: Number(r.in_zat),
      outZat: Number(r.out_zat),
    }));
  }

  async inflowByAddressKind(): Promise<InflowKindMonthPoint[]> {
    const { rows } = await this.#pool.query<{
      ts: string;
      kind: ZcashAddressKind | null;
      transfers: string;
      zat: string;
    }>(
      `SELECT ${utcBucketEpoch("month")} AS ts,
              zcash_address_kind AS kind,
              count(*)::bigint AS transfers,
              SUM(zec_amount_zat)::bigint AS zat
         FROM crosschain_transfer
        WHERE direction = 'in' AND counterpart_asset <> ALL($1)
        GROUP BY 1, 2
        ORDER BY 1, 2`,
      [SETTLEMENT_ASSETS],
    );
    return rows.map((r) => ({
      timestamp: Number(r.ts),
      kind: r.kind,
      transfers: Number(r.transfers),
      zat: Number(r.zat),
    }));
  }

  async markSuccess(protocol: CrossChainProtocol, atSeconds: number): Promise<void> {
    await this.writeIngestState(`venue:${protocol}`, { lastSuccessAt: atSeconds, lastError: null });
  }

  async markFailure(protocol: CrossChainProtocol, error: string): Promise<void> {
    const previous = await this.readIngestState<{ lastSuccessAt: number | null }>(
      `venue:${protocol}`,
    );
    await this.writeIngestState(`venue:${protocol}`, {
      lastSuccessAt: previous?.lastSuccessAt ?? null,
      lastError: error,
    });
  }

  /**
   * Liveness survives a restart, unlike the in-memory adapter's. Still derived from the last
   * success timestamp rather than a stored boolean, so a process that has not yet polled does not
   * inherit health it has not demonstrated.
   */
  async health(
    protocols: readonly CrossChainProtocol[],
    nowSeconds: number,
  ): Promise<VenueHealth[]> {
    const { rows } = await this.#pool.query<{ key: string; state: Record<string, unknown> }>(
      `SELECT key, state FROM ingest_state WHERE key = ANY($1)`,
      [protocols.map((p) => `venue:${p}`)],
    );
    const byProtocol = new Map(rows.map((r) => [r.key.replace("venue:", ""), r.state]));
    return protocols.map((protocol) => {
      const state = byProtocol.get(protocol);
      const lastSuccessAt = typeof state?.lastSuccessAt === "number" ? state.lastSuccessAt : null;
      const lastError = typeof state?.lastError === "string" ? state.lastError : null;
      return {
        protocol,
        lastSuccessAt,
        lastError,
        live: lastSuccessAt !== null && nowSeconds - lastSuccessAt < VENUE_STALE_AFTER_SECONDS,
      };
    });
  }

  async readIngestState<T>(key: string): Promise<T | null> {
    const { rows } = await this.#pool.query<{ state: T }>(
      `SELECT state FROM ingest_state WHERE key = $1`,
      [key],
    );
    return rows[0]?.state ?? null;
  }

  async writeIngestState(key: string, state: unknown): Promise<void> {
    await this.#pool.query(
      `INSERT INTO ingest_state (key, state, updated_at) VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET state = EXCLUDED.state, updated_at = EXCLUDED.updated_at`,
      [key, JSON.stringify(state), Math.floor(Date.now() / 1000)],
    );
  }

  /**
   * The shielded-capable-destination statistic, served by `crosschain_transfer_kind_idx`.
   * Settlement legs are excluded, by asset (a chain filter would drop every wrapped-ZEC crossing),
   * and the null bucket is a real null, never the string "null".
   */
  async countByAddressKind(direction: CrossChainDirection): Promise<AddressKindBucket[]> {
    const { rows } = await this.#pool.query<{
      kind: AddressKindBucket["kind"];
      transfers: number;
      zec: number;
    }>(
      `SELECT zcash_address_kind AS kind,
              count(*)::bigint AS transfers,
              COALESCE(SUM(zec_amount_zat), 0)::bigint AS zec
         FROM crosschain_transfer
        WHERE direction = $1
          AND NOT (counterpart_asset = ANY($2))
        GROUP BY zcash_address_kind
        ORDER BY zec DESC`,
      [direction, SETTLEMENT_ASSETS],
    );
    return rows.map((r) => ({
      kind: r.kind,
      transfers: Number(r.transfers),
      zecAmountZat: Number(r.zec),
    }));
  }

  /**
   * Gross ZEC per (counterpart chain, direction, Zcash address kind): `/pulse`'s ribbons.
   *
   * Completed only, unlike every other aggregate here: a ribbon states value that crossed, and
   * `crosschain_transfer.status` also permits `pending` (has not happened) and `refunded` (was
   * undone). Served by `crosschain_transfer_kind_idx (direction, zcash_address_kind)`, with the
   * settlement filter by asset as everywhere else.
   */
  async crossChainEdges(fromTimestamp: number | null): Promise<CrossChainEdgeRow[]> {
    const { rows } = await this.#pool.query<{
      chain: string;
      direction: CrossChainDirection;
      kind: AddressKindBucket["kind"];
      transfers: string;
      zec: string;
    }>(
      `SELECT counterpart_chain AS chain, direction, zcash_address_kind AS kind,
              count(*)::bigint AS transfers,
              COALESCE(SUM(zec_amount_zat), 0)::bigint AS zec
         FROM crosschain_transfer
        WHERE status = 'completed'
          AND NOT (counterpart_asset = ANY($1))
          AND ($2::bigint IS NULL OR timestamp >= $2)
        GROUP BY 1, 2, 3`,
      [SETTLEMENT_ASSETS, fromTimestamp],
    );
    return rows.map((r) => ({
      chain: r.chain,
      direction: r.direction,
      addressKind: r.kind,
      transfers: Number(r.transfers),
      zecAmountZat: Number(r.zec),
    }));
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }
}
