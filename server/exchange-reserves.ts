import type { Pool, PoolClient } from "pg";
import type { ZcashNetwork } from "@/lib/network";
import {
  closingBalances,
  type AddressDayBalance,
  type ReserveDayClose,
  type ExchangeMember,
} from "@/domain";
import { REORG_DEPTH } from "./follow";
import type { Pacer } from "./job-pacer";
import { rollbackQuietly } from "./pg-pool";
import "./pg-types";

/**
 * Each tracked address's balance at every UTC day's highest block: `address_balance_daily`, for
 * the addresses counted under an exchange.
 *
 * A balance is outputs minus inputs over `tx_transparent_io`, the rich list's own definition, so a
 * stored balance is held to `chain_address_balance` at a fixed height (`RESERVE_RECONCILE_SQL`).
 * The walk reads `io_address_idx`, one address at a time; the busiest address holds ~700k rows, so
 * the first pass goes in height chunks with the pacer resting between them.
 *
 * Final only past the reorg depth: a day is stored once its highest block is at least
 * `REORG_DEPTH` below the tip, so a row never needs taking back. The days above are computed live
 * when read (`loadReserveRows`), which is at most a day or two of blocks once caught up.
 */

/** Heights per chunk of the walk: ~70 chunks for the chain, each a few seconds. */
export const RESERVE_CHUNK_BLOCKS = 50_000;

/** The smallest chunk a failed one shrinks to. */
export const RESERVE_MIN_CHUNK_BLOCKS = 1_000;

/**
 * How many days an address's stored day may stand before the final day (the UTC day of the block
 * `REORG_DEPTH` below the tip) and still be read live. Measured in days, not blocks: a day is
 * ~3,456 blocks at 25 seconds. A caught-up watermark stands one or two days before the final day
 * (two until the final day is a dozen blocks old); three leaves a day for a paused pass. Further
 * behind (a first pass, or a pass stalled for days), an address gets no live days and the read
 * says so (`ReserveRows.beyondLiveTail`). A live read is then at most four days of blocks.
 */
export const RESERVE_LIVE_TAIL_MAX_DAYS = 3;

const DAY_SEC = 86_400;

/** Whether an address stored through `throughDay` is read live when the final day is `finalDay`. */
export function withinLiveTail(throughDay: number | null, finalDay: number): boolean {
  return throughDay !== null && finalDay - throughDay <= RESERVE_LIVE_TAIL_MAX_DAYS * DAY_SEC;
}

/**
 * The newest block's height, and the unix second the final day starts: the UTC day of the block
 * `REORG_DEPTH` below the tip, or of the tip on a chain shorter than that. Null on an empty index.
 */
async function newestBlock(
  pool: Pool | PoolClient,
): Promise<{ height: number; finalDay: number } | null> {
  const { rows } = await pool.query<{ height: number; final_ts: number }>(
    `SELECT t.height, coalesce(f.timestamp, t.timestamp) AS final_ts
       FROM (SELECT height, timestamp FROM block ORDER BY height DESC LIMIT 1) t
       LEFT JOIN LATERAL (SELECT timestamp FROM block WHERE height = t.height - $1) f ON true`,
    [REORG_DEPTH],
  );
  const r = rows[0];
  return r === undefined
    ? null
    : { height: r.height, finalDay: Math.floor(r.final_ts / DAY_SEC) * DAY_SEC };
}

/**
 * Blocks above a day's highest block before the day counts as closed. A block's time must exceed
 * the median of the eleven before it, so once a dozen later blocks are stamped the next day, none
 * after them can be stamped back into this one.
 */
export const CLOSE_SETTLE_BLOCKS = 12;

/** The UTC day a block's timestamp falls on, as SQL, whatever the session's time zone. */
const BLOCK_DAY = "(to_timestamp(b.timestamp) AT TIME ZONE 'UTC')::date";

/** Every day stamped by a block in `lo`..`hi`, with the highest such block. */
export async function dayCloses(
  pool: Pool | PoolClient,
  lo: number,
  hi: number | null,
): Promise<ReserveDayClose[]> {
  const { rows } = await pool.query<{ day: number; close: number }>(
    `SELECT EXTRACT(EPOCH FROM d)::bigint AS day, max(height) AS close
       FROM (SELECT ${BLOCK_DAY} AS d, b.height FROM block b
              WHERE b.height >= $1 AND ($2::int IS NULL OR b.height <= $2)) s
      GROUP BY d ORDER BY d`,
    [lo, hi],
  );
  return rows;
}

/** Each address's net change per block in `lo`..`hi`: outputs minus inputs, NULL values ignored. */
export async function addressDeltas(
  pool: Pool | PoolClient,
  addresses: readonly string[],
  lo: number,
  hi: number | null,
): Promise<Map<string, [number, number][]>> {
  const { rows } = await pool.query<{ address: string; height: number; delta: number }>(
    `SELECT address, block_height AS height,
            sum(CASE io WHEN 'out' THEN coalesce(value_zat, 0) ELSE -coalesce(value_zat, 0) END)::bigint AS delta
       FROM tx_transparent_io
      WHERE address = ANY($1::text[]) AND block_height >= $2 AND ($3::int IS NULL OR block_height <= $3)
      GROUP BY address, block_height`,
    [addresses, lo, hi],
  );
  const out = new Map<string, [number, number][]>(addresses.map((a) => [a, []]));
  for (const r of rows) out.get(r.address)?.push([r.height, r.delta]);
  return out;
}

export interface ReserveState {
  address: string;
  throughHeight: number;
  /** Unix seconds of `through_day`, or null before the first day. */
  throughDay: number | null;
  balanceZat: number;
  seen: boolean;
}

export async function readReserveStates(
  pool: Pool | PoolClient,
  addresses: readonly string[],
): Promise<ReserveState[]> {
  const { rows } = await pool.query<{
    address: string;
    through_height: number;
    through_day: number | null;
    balance_zat: number;
    seen: boolean;
  }>(
    `SELECT address, through_height, EXTRACT(EPOCH FROM through_day)::bigint AS through_day,
            balance_zat, first_day IS NOT NULL AS seen
       FROM address_balance_daily_state WHERE address = ANY($1::text[]) ORDER BY address`,
    [addresses],
  );
  return rows.map((r) => ({
    address: r.address,
    throughHeight: r.through_height,
    throughDay: r.through_day,
    balanceZat: r.balance_zat,
    seen: r.seen,
  }));
}

/**
 * Store `rows` for a group of addresses that all stood at `fromHeight`, and move each one's
 * watermark to `throughHeight` / `throughDay`, in one transaction and only if every one still stood
 * there. Anything else means another pass moved them, so nothing is written. False when refused.
 */
export async function applyReserveChunk(
  pool: Pool,
  group: readonly ReserveState[],
  rows: readonly AddressDayBalance[],
  through: { height: number; day: number },
  nowSec: number,
): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const fromHeight = group[0]!.throughHeight;
    const last = new Map<string, AddressDayBalance>();
    for (const r of rows) last.set(r.address, r);
    const firstDay = new Map<string, number>();
    for (const r of rows) if (!firstDay.has(r.address)) firstDay.set(r.address, r.day);
    const moved = await client.query(
      `UPDATE address_balance_daily_state s
          SET through_height = $2,
              through_day = (to_timestamp($3::bigint) AT TIME ZONE 'UTC')::date,
              balance_zat = u.balance,
              first_day = coalesce(s.first_day, (to_timestamp(u.first_day) AT TIME ZONE 'UTC')::date),
              updated_at = $4
         FROM unnest($5::text[], $6::bigint[], $7::bigint[]) AS u(address, balance, first_day)
        WHERE s.address = u.address AND s.through_height = $1`,
      [
        fromHeight,
        through.height,
        through.day,
        nowSec,
        group.map((g) => g.address),
        group.map((g) => last.get(g.address)?.balanceZat ?? g.balanceZat),
        group.map((g) => firstDay.get(g.address) ?? null),
      ],
    );
    if (moved.rowCount !== group.length) {
      await client.query("ROLLBACK");
      return false;
    }
    if (rows.length > 0) {
      await client.query(
        `INSERT INTO address_balance_daily (address, day, balance_zat, close_height)
         SELECT a, (to_timestamp(d) AT TIME ZONE 'UTC')::date, b, h
           FROM unnest($1::text[], $2::bigint[], $3::bigint[], $4::int[]) AS u(a, d, b, h)
         ON CONFLICT (address, day) DO UPDATE
           SET balance_zat = EXCLUDED.balance_zat, close_height = EXCLUDED.close_height`,
        [
          rows.map((r) => r.address),
          rows.map((r) => r.day),
          rows.map((r) => r.balanceZat),
          rows.map((r) => r.closeHeight),
        ],
      );
    }
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }
}

/** Each group's balances at `closes`, from its watermark and the blocks above it. */
function balancesAt(
  group: readonly ReserveState[],
  deltas: ReadonlyMap<string, [number, number][]>,
  closes: readonly ReserveDayClose[],
): AddressDayBalance[] {
  return group.flatMap((s) =>
    closingBalances(
      s.address,
      { fromHeight: s.throughHeight, balanceZat: s.balanceZat, seen: s.seen },
      deltas.get(s.address) ?? [],
      closes.filter((c) => s.throughDay === null || c.day > s.throughDay),
    ),
  );
}

// ------------------------------------------------------------------------------ the read

export interface ReserveRows {
  rows: AddressDayBalance[];
  /** The last day each address is known through: stored or live. Null before its first pass. */
  computedThrough: Map<string, number | null>;
  /**
   * Addresses with stored days that are further behind than `RESERVE_LIVE_TAIL_MAX_DAYS`, so this
   * read computed none of their days live: a limit of this read, never a claim about the chain.
   */
  beyondLiveTail: string[];
  /** The newest block the live days read, or null when nothing was read live. */
  tipHeight: number | null;
}

/**
 * Every stored day for `addresses`, plus the days above each watermark computed live, today's
 * through the newest block. An address stored more than `RESERVE_LIVE_TAIL_MAX_DAYS` behind (its
 * first pass still running) gets no live days, is listed in `beyondLiveTail`, and
 * `computedThrough` says how far it is known.
 */
export async function loadReserveRows(
  pool: Pool,
  addresses: readonly string[],
): Promise<ReserveRows> {
  const client = await pool.connect();
  try {
    // One snapshot, so a chunk applied between two reads is neither missed nor counted twice. The
    // reads go one after another: a client runs one query at a time.
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const stored = await client.query<{
      address: string;
      day: number;
      balance_zat: number;
      close_height: number;
    }>(
      `SELECT address, EXTRACT(EPOCH FROM day)::bigint AS day, balance_zat, close_height
         FROM address_balance_daily WHERE address = ANY($1::text[]) ORDER BY day, address`,
      [addresses],
    );
    const states = await readReserveStates(client, addresses);
    const newest = await newestBlock(client);
    const rows: AddressDayBalance[] = stored.rows.map((r) => ({
      address: r.address,
      day: r.day,
      balanceZat: r.balance_zat,
      closeHeight: r.close_height,
    }));
    const computedThrough = new Map<string, number | null>(addresses.map((a) => [a, null]));
    for (const s of states) computedThrough.set(s.address, s.throughDay);
    const tip = newest?.height ?? null;
    const live =
      newest === null
        ? []
        : states.filter(
            (s) => s.throughHeight >= 0 && withinLiveTail(s.throughDay, newest.finalDay),
          );
    const beyondLiveTail =
      newest === null
        ? []
        : states
            .filter((s) => s.throughHeight >= 0 && !withinLiveTail(s.throughDay, newest.finalDay))
            .map((s) => s.address);
    if (tip !== null && live.length > 0) {
      const from = Math.min(...live.map((s) => s.throughHeight)) + 1;
      const closes = await dayCloses(client, from, null);
      const deltas = await addressDeltas(
        client,
        live.map((s) => s.address),
        from,
        null,
      );
      rows.push(...balancesAt(live, deltas, closes));
      const lastDay = closes.at(-1)?.day;
      if (lastDay !== undefined) {
        for (const s of live) computedThrough.set(s.address, Math.max(lastDay, s.throughDay ?? 0));
      }
    }
    await client.query("COMMIT");
    return { rows, computedThrough, beyondLiveTail, tipHeight: live.length > 0 ? tip : null };
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Every tracked address's stored balance carried to the rich list's own height, beside the rich
 * list's balance there; one row each, in one snapshot. Every row must agree (`stored = expected`);
 * an address whose watermark is above the rich list's height cannot be compared and says so with a
 * NULL `stored`. Run read-only in production:
 *
 *   psql "$DATABASE_URL" -c "<this statement with $1 the addresses>"
 */
export const RESERVE_RECONCILE_SQL = `
  WITH meta AS (SELECT computed_height AS h FROM chain_rich_list_meta WHERE id)
  SELECT s.address,
         meta.h AS height,
         CASE WHEN s.through_height > meta.h THEN NULL ELSE
           s.balance_zat + coalesce((
             SELECT sum(CASE io WHEN 'out' THEN coalesce(value_zat, 0) ELSE -coalesce(value_zat, 0) END)
               FROM tx_transparent_io i
              WHERE i.address = s.address AND i.block_height > s.through_height
                AND i.block_height <= meta.h), 0)
         END::bigint AS stored,
         coalesce(c.balance_zat, 0)::bigint AS expected,
         (SELECT d.balance_zat FROM address_balance_daily d
           WHERE d.address = s.address ORDER BY d.day DESC LIMIT 1) AS last_row,
         s.balance_zat AS state_balance
    FROM address_balance_daily_state s CROSS JOIN meta
    LEFT JOIN chain_address_balance c ON c.address = s.address
   WHERE s.address = ANY($1::text[])
   ORDER BY s.address`;

export interface ReserveReconcileRow {
  address: string;
  height: number;
  stored: number | null;
  expected: number;
  lastRow: number | null;
  stateBalance: number;
}

/** `RESERVE_RECONCILE_SQL`, in one read-only snapshot so the rich list cannot move under it. */
export async function reconcileReserves(
  pool: Pool,
  addresses: readonly string[],
): Promise<ReserveReconcileRow[]> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const { rows } = await client.query<{
      address: string;
      height: number;
      stored: number | null;
      expected: number;
      last_row: number | null;
      state_balance: number;
    }>(RESERVE_RECONCILE_SQL, [addresses]);
    await client.query("COMMIT");
    return rows.map((r) => ({
      address: r.address,
      height: r.height,
      stored: r.stored,
      expected: r.expected,
      lastRow: r.last_row,
      stateBalance: r.state_balance,
    }));
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }
}

// ------------------------------------------------------------------------------ tracker

export interface ReserveTrackerDeps {
  pool: Pool;
  /** The members are mainnet addresses, so on any other network a pass does nothing. */
  network: ZcashNetwork;
  members: readonly ExchangeMember[];
  /** A fresh pacer per pass, so a pass that aborted on a stall starts the next one clean. */
  pacer: () => Pacer;
  log: (m: string) => void;
  now?: () => number;
  /**
   * Whether a first pass may run now. Like the address counts, the walk waits for the transparent
   * backfill, so one chain-wide pass runs beside ingestion at a time. Keeping up never waits.
   */
  ready?: () => Promise<boolean>;
  /** Injectable for tests. */
  chunkBlocks?: number;
  /** The smallest a failed chunk shrinks to; injectable for tests. */
  minChunkBlocks?: number;
  /** `CLOSE_SETTLE_BLOCKS`, injectable for a test chain whose blocks are hours apart. */
  settleBlocks?: number;
}

/**
 * Delete the state and every stored day of each tracked address not in `addresses`, in one
 * transaction. The open dataset publishes the whole table and requires every address to reach the
 * final day, so a label taken off the list (a theft flag, a re-mapped name) must take its rows with
 * it. Returns how many addresses were dropped.
 *
 * An empty list prunes nothing and returns 0: a misconfigured (empty) list must never empty the
 * table.
 */
export async function pruneReserveAddresses(
  pool: Pool,
  addresses: readonly string[],
): Promise<number> {
  if (addresses.length === 0) return 0;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM address_balance_daily WHERE NOT (address = ANY($1::text[]))", [
      addresses,
    ]);
    const dropped = await client.query(
      "DELETE FROM address_balance_daily_state WHERE NOT (address = ANY($1::text[]))",
      [addresses],
    );
    await client.query("COMMIT");
    return dropped.rowCount ?? 0;
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Keeps `address_balance_daily` current: on start, then every ten minutes, on mainnet only. Each
 * step takes the addresses furthest behind, which share one watermark, and walks the next chunk of
 * heights for them; an address added to the list later catches up from genesis this way while the
 * rest wait. The last day a chunk touches may continue above it, so it is left for the next chunk.
 * A chunk that fails (above all one overrunning its statement bound) is retried smaller.
 *
 * The table holds exactly the listed addresses: each pass first deletes the state and rows of any
 * address no longer listed (`pruneReserveAddresses`). An empty list prunes nothing, so a
 * misconfigured list cannot empty the table.
 */
export class ReserveTracker {
  #running = false;
  #chunk: number;
  constructor(private readonly deps: ReserveTrackerDeps) {
    this.#chunk = deps.chunkBlocks ?? RESERVE_CHUNK_BLOCKS;
  }

  /** The chunk the next step walks; smaller after a failure, back to full after a success. */
  get chunkBlocks(): number {
    return this.#chunk;
  }

  async refresh(): Promise<{ days: number; aborted: boolean }> {
    if (this.#running || this.deps.network !== "mainnet") return { days: 0, aborted: false };
    this.#running = true;
    const now = this.deps.now ?? Date.now;
    const { pool } = this.deps;
    const addresses = this.deps.members.map((m) => m.address);
    const fullChunk = this.deps.chunkBlocks ?? RESERVE_CHUNK_BLOCKS;
    const settle = this.deps.settleBlocks ?? CLOSE_SETTLE_BLOCKS;
    try {
      const newest = await newestBlock(pool);
      if (newest === null || addresses.length === 0) return { days: 0, aborted: false };
      const dropped = await pruneReserveAddresses(pool, addresses);
      if (dropped > 0) {
        this.deps.log(`exchange reserves: dropped ${dropped} address(es) no longer listed`);
      }
      const final = newest.height - REORG_DEPTH;
      await pool.query(
        `INSERT INTO address_balance_daily_state (address, through_height, balance_zat, updated_at)
         SELECT a, -1, 0, $2 FROM unnest($1::text[]) AS a ON CONFLICT (address) DO NOTHING`,
        [addresses, Math.floor(now() / 1000)],
      );
      let pacer: Pacer | null = null;
      let days = 0;
      for (;;) {
        const states = await readReserveStates(pool, addresses);
        const low = Math.min(...states.map((s) => s.throughHeight));
        const group = states.filter((s) => s.throughHeight === low);
        const lo = low + 1;
        if (lo > final) break;
        if (pacer === null) {
          if (
            !withinLiveTail(group[0]!.throughDay, newest.finalDay) &&
            this.deps.ready &&
            !(await this.deps.ready())
          ) {
            return { days, aborted: false };
          }
          pacer = this.deps.pacer();
          await pacer.preflight();
        }
        const started = now();
        const throughDay = group[0]!.throughDay;
        // The last day may continue above `hi`, so it waits for the next chunk. So does a day
        // closing within `CLOSE_SETTLE_BLOCKS` of `hi`: a block just above can still be stamped
        // into it across midnight. A chunk holding only part of one day is widened until a day
        // completes or the final height is reached.
        const chunk = this.#chunk;
        let closes: ReserveDayClose[] = [];
        let throughHeight = 0;
        let ok: boolean;
        try {
          for (let hi = Math.min(final, lo + chunk - 1); ; hi = Math.min(final, hi + chunk)) {
            closes = (await dayCloses(pool, lo, hi))
              .filter((c) => throughDay === null || c.day > throughDay)
              .slice(0, -1)
              .filter((c) => c.close <= hi - settle);
            if (closes.length > 0 || hi === final) break;
          }
          if (closes.length === 0) break;
          throughHeight = Math.max(...closes.map((c) => c.close));
          const deltas = await addressDeltas(
            pool,
            group.map((g) => g.address),
            lo,
            throughHeight,
          );
          ok = await applyReserveChunk(
            pool,
            group,
            balancesAt(group, deltas, closes),
            { height: throughHeight, day: closes.at(-1)!.day },
            Math.floor(now() / 1000),
          );
        } catch (error) {
          // Retried at the same size, a chunk that overran its statement bound would fail on
          // every pass.
          this.#chunk = Math.max(
            this.deps.minChunkBlocks ?? RESERVE_MIN_CHUNK_BLOCKS,
            Math.floor(chunk / 4),
          );
          throw error;
        }
        this.#chunk = Math.min(fullChunk, chunk * 2);
        if (!ok) {
          this.deps.log("exchange reserves: a watermark moved under this pass; stopping it");
          return { days, aborted: true };
        }
        days += closes.length * group.length;
        if ((await pacer.afterUnit(Math.max(1, now() - started))) === "abort") {
          this.deps.log(
            `exchange reserves: paused at height ${throughHeight}, ingestion is behind`,
          );
          return { days, aborted: true };
        }
      }
      if (days > 30)
        this.deps.log(`exchange reserves: ${days} address-days through height ${final}`);
      return { days, aborted: false };
    } finally {
      this.#running = false;
    }
  }

  start(intervalMs = 10 * 60 * 1000): () => void {
    const run = (): void => {
      void this.refresh().catch((e: unknown) => {
        this.deps.log(`exchange reserves: pass failed, will retry — ${String(e)}`);
      });
    };
    run();
    const timer = setInterval(run, intervalMs);
    timer.unref();
    return () => clearInterval(timer);
  }
}
