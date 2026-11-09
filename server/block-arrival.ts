import type { Pool } from "pg";
import {
  ARRIVAL_ALL_GROUP,
  ARRIVAL_LATE_SECONDS,
  ARRIVAL_MIN_BLOCKS,
  BLOCK_ARRIVAL_WINDOWS,
  BLOCK_ARRIVAL_WINDOW_DAYS,
  MINING_POOL_LABELS,
  UNATTRIBUTED_GROUP,
  sortArrivalCells,
  type BlockArrivalCell,
  type BlockArrivalDay,
  type BlockArrivalSeries,
  type BlockArrivalWindow,
  type BlockArrivalWindowKey,
} from "@/domain";
import { DAY_SECONDS, utcDayFromSeconds } from "@/domain/time";
import type { Pacer } from "./job-pacer";

/**
 * Block age on arrival, per UTC day and reviewed mining pool, kept in `block_arrival_day` and
 * `block_arrival_window` by the API's primary (`BlockArrivalTracker`), never by the follower.
 *
 * A day is one range read of `block` on `block_timestamp_idx`: a few thousand rows at NU7's 25 s
 * target. The windows are three larger range reads per pass. Pools are this site's reviewed labels
 * on payout addresses (`MINING_POOL_LABELS`), passed in as array parameters, so no SQL is built
 * from the registry and an address no label names is `unattributed`, as on `/miners`.
 *
 * Percentiles are `percentile_disc` (nearest rank): every age reported is one a block had. They
 * do not combine: a window's median is computed over the window's blocks, never from its days'.
 */

const registry = (() => {
  const addresses = Object.keys(MINING_POOL_LABELS).sort();
  return { addresses, pools: addresses.map((a) => MINING_POOL_LABELS[a]!.miningPool) };
})();

/**
 * Every group over `[$1, $2)` unix seconds, plus the `all` row from the ROLLUP. A block with no
 * stamp has a NULL age, which every FILTER below leaves out and `blocks` still counts.
 */
export const BLOCK_ARRIVAL_SPAN_SQL = `
  WITH reg AS (SELECT * FROM unnest($3::text[], $4::text[]) AS r(address, pool)),
  b AS (
    SELECT COALESCE(reg.pool, '${UNATTRIBUTED_GROUP}') AS grp,
           blk.received_at - blk.timestamp AS age
      FROM block blk
      LEFT JOIN reg ON reg.address = blk.miner_address
     WHERE blk.timestamp >= $1::bigint AND blk.timestamp < $2::bigint
  )
  SELECT COALESCE(grp, '${ARRIVAL_ALL_GROUP}') AS grp,
         count(*)::int AS blocks,
         count(*) FILTER (WHERE age <= $5)::int AS measured,
         count(*) FILTER (WHERE age > $5)::int AS late,
         percentile_disc(0.5) WITHIN GROUP (ORDER BY age) FILTER (WHERE age <= $5) AS p50,
         percentile_disc(0.9) WITHIN GROUP (ORDER BY age) FILTER (WHERE age <= $5) AS p90
    FROM b
   GROUP BY ROLLUP (grp)`;

interface SpanRow {
  grp: string;
  blocks: number;
  measured: number;
  late: number;
  p50: string | number | null;
  p90: string | number | null;
}

/** The cells for `[from, to)`, percentiles withheld below the minimum. Empty when no block. */
export async function computeArrivalSpan(
  pool: Pick<Pool, "query">,
  from: number,
  to: number,
): Promise<BlockArrivalCell[]> {
  const { rows } = await pool.query<SpanRow>(BLOCK_ARRIVAL_SPAN_SQL, [
    from,
    to,
    registry.addresses,
    registry.pools,
    ARRIVAL_LATE_SECONDS,
  ]);
  return rows.map((r) => {
    const enough = r.measured >= ARRIVAL_MIN_BLOCKS;
    return {
      group: r.grp,
      blocks: r.blocks,
      measured: r.measured,
      late: r.late,
      p50Seconds: enough && r.p50 !== null ? Number(r.p50) : null,
      p90Seconds: enough && r.p90 !== null ? Number(r.p90) : null,
    };
  });
}

/** Replaces one day's rows whole, so a group that lost its blocks to a reorg loses its row. */
export async function storeArrivalDay(
  pool: Pool,
  dayStart: number,
  cells: readonly BlockArrivalCell[],
  nowSec: number,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `DELETE FROM block_arrival_day WHERE day = (to_timestamp($1) AT TIME ZONE 'UTC')::date`,
      [dayStart],
    );
    await insertDayCells(client, dayStart, cells, nowSec);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function insertDayCells(
  client: Pick<Pool, "query">,
  dayStart: number,
  cells: readonly BlockArrivalCell[],
  nowSec: number,
): Promise<void> {
  if (cells.length === 0) return;
  await client.query(
    `INSERT INTO block_arrival_day (day, grp, blocks, measured, late, p50_seconds, p90_seconds, computed_at)
     SELECT (to_timestamp($1) AT TIME ZONE 'UTC')::date, u.g, u.b, u.m, u.l, u.p50, u.p90, $8
       FROM unnest($2::text[], $3::int[], $4::int[], $5::int[], $6::int[], $7::int[])
         AS u(g, b, m, l, p50, p90)`,
    [
      dayStart,
      cells.map((c) => c.group),
      cells.map((c) => c.blocks),
      cells.map((c) => c.measured),
      cells.map((c) => c.late),
      cells.map((c) => c.p50Seconds),
      cells.map((c) => c.p90Seconds),
      nowSec,
    ],
  );
}

/** Replaces one window's rows whole. */
export async function storeArrivalWindow(
  pool: Pool,
  window: BlockArrivalWindowKey,
  fromDay: number,
  cells: readonly BlockArrivalCell[],
  nowSec: number,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM block_arrival_window WHERE window_key = $1`, [window]);
    if (cells.length > 0) {
      await client.query(
        `INSERT INTO block_arrival_window
           (window_key, from_day, to_day, grp, blocks, measured, late, p50_seconds, p90_seconds,
            computed_at)
         SELECT $1, (to_timestamp($2) AT TIME ZONE 'UTC')::date,
                (to_timestamp($3) AT TIME ZONE 'UTC')::date, u.g, u.b, u.m, u.l, u.p50, u.p90, $10
           FROM unnest($4::text[], $5::int[], $6::int[], $7::int[], $8::int[], $9::int[])
             AS u(g, b, m, l, p50, p90)`,
        [
          window,
          fromDay,
          nowSec,
          cells.map((c) => c.group),
          cells.map((c) => c.blocks),
          cells.map((c) => c.measured),
          cells.map((c) => c.late),
          cells.map((c) => c.p50Seconds),
          cells.map((c) => c.p90Seconds),
          nowSec,
        ],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

const midnight = (sec: number) => Math.floor(sec / DAY_SECONDS) * DAY_SECONDS;

/**
 * The first UTC day with a stamped block, or null before any. Read from the table once it holds a
 * measured day; the very first pass scans `block` for it (no index on `received_at`), once.
 */
export async function arrivalRecordingStart(pool: Pick<Pool, "query">): Promise<number | null> {
  const stored = await pool.query<{ day: string | null }>(
    `SELECT EXTRACT(EPOCH FROM min(day))::bigint::text AS day FROM block_arrival_day
      WHERE grp = '${ARRIVAL_ALL_GROUP}' AND measured + late > 0`,
  );
  const known = stored.rows[0]?.day;
  if (known != null) return Number(known);
  const scanned = await pool.query<{ ts: string | null }>(
    `SELECT min(timestamp)::text AS ts FROM block WHERE received_at IS NOT NULL`,
  );
  const ts = scanned.rows[0]?.ts;
  return ts == null ? null : midnight(Number(ts));
}

/** The days to (re)compute: every recorded day missing, plus today and yesterday. */
export async function arrivalDaysToCompute(
  pool: Pick<Pool, "query">,
  nowSec: number,
): Promise<number[]> {
  const start = await arrivalRecordingStart(pool);
  if (start === null) return [];
  const today = midnight(nowSec);
  const done = await pool.query<{ day: string }>(
    `SELECT EXTRACT(EPOCH FROM day)::bigint::text AS day FROM block_arrival_day
      WHERE grp = '${ARRIVAL_ALL_GROUP}'`,
  );
  const have = new Set(done.rows.map((r) => Number(r.day)));
  const days: number[] = [];
  for (let d = start; d <= today; d += DAY_SECONDS) {
    // Today and yesterday stay open: late blocks stamped into them and reorgs are absorbed.
    if (d >= today - DAY_SECONDS || !have.has(d)) days.push(d);
  }
  return days;
}

interface StoredCell {
  day?: string;
  window_key?: string;
  from_day?: string;
  to_day?: string;
  grp: string;
  blocks: number;
  measured: number;
  late: number;
  p50_seconds: number | null;
  p90_seconds: number | null;
}

const cellOf = (r: StoredCell): BlockArrivalCell => ({
  group: r.grp,
  blocks: r.blocks,
  measured: r.measured,
  late: r.late,
  p50Seconds: r.p50_seconds,
  p90Seconds: r.p90_seconds,
});

/** Every stored day and window: a few thousand rows, read whole into a memo. */
export async function loadBlockArrival(
  pool: Pick<Pool, "query">,
  nowSec: number,
): Promise<BlockArrivalSeries> {
  const [days, windows] = await Promise.all([
    pool.query<StoredCell>(
      `SELECT to_char(day, 'YYYY-MM-DD') AS day, grp, blocks, measured, late, p50_seconds,
              p90_seconds
         FROM block_arrival_day ORDER BY day`,
    ),
    pool.query<StoredCell>(
      `SELECT window_key, to_char(from_day, 'YYYY-MM-DD') AS from_day,
              to_char(to_day, 'YYYY-MM-DD') AS to_day, grp, blocks, measured, late, p50_seconds,
              p90_seconds
         FROM block_arrival_window`,
    ),
  ]);
  const today = utcDayFromSeconds(nowSec);
  const byDay = new Map<string, BlockArrivalCell[]>();
  for (const r of days.rows) byDay.set(r.day!, [...(byDay.get(r.day!) ?? []), cellOf(r)]);
  const series: BlockArrivalDay[] = [...byDay.entries()].map(([day, cells]) => ({
    day,
    partial: day >= today,
    groups: sortArrivalCells(cells),
  }));
  // Days before the first stamped one carry nothing and are not part of the record.
  const first = series.findIndex((d) =>
    d.groups.some((g) => g.group === ARRIVAL_ALL_GROUP && g.measured + g.late > 0),
  );
  const recorded = first < 0 ? [] : series.slice(first);
  const byWindow = new Map<string, StoredCell[]>();
  for (const r of windows.rows) {
    byWindow.set(r.window_key!, [...(byWindow.get(r.window_key!) ?? []), r]);
  }
  const summaries: BlockArrivalWindow[] = BLOCK_ARRIVAL_WINDOWS.flatMap((w) => {
    const rows = byWindow.get(w);
    if (!rows || rows.length === 0) return [];
    return [
      {
        window: w,
        fromDay: rows[0]!.from_day!,
        toDay: rows[0]!.to_day!,
        groups: sortArrivalCells(rows.map(cellOf)),
      },
    ];
  });
  return {
    recordingSince: recorded[0]?.day ?? null,
    lateSeconds: ARRIVAL_LATE_SECONDS,
    minBlocks: ARRIVAL_MIN_BLOCKS,
    days: recorded,
    windows: summaries,
    asOf: nowSec,
  };
}

export interface BlockArrivalTrackerDeps {
  pool: Pool;
  /** A fresh pacer per pass, so a pass that aborted on a stall starts the next one clean. */
  pacer: () => Pacer;
  log: (m: string) => void;
  now?: () => number;
}

/**
 * Keeps `block_arrival_day` and `block_arrival_window` current: on start, then every ten minutes.
 * The first pass is the backfill from the day recording began, one paced unit per day; later
 * passes recompute today and yesterday, then the three windows. A pass the pacer stops is
 * abandoned and the next resumes from the days still missing: each day and window is replaced
 * whole, so nothing is double-counted.
 */
export class BlockArrivalTracker {
  #running = false;
  constructor(private readonly deps: BlockArrivalTrackerDeps) {}

  async refresh(): Promise<{ computed: number; aborted: boolean }> {
    if (this.#running) return { computed: 0, aborted: false };
    this.#running = true;
    const now = this.deps.now ?? Date.now;
    const sec = () => Math.floor(now() / 1000);
    try {
      const days = await arrivalDaysToCompute(this.deps.pool, sec());
      if (days.length === 0) return { computed: 0, aborted: false };
      const pacer = this.deps.pacer();
      await pacer.preflight();
      let computed = 0;
      const units: Array<() => Promise<void>> = [
        ...days.map((d) => async () => {
          const cells = await computeArrivalSpan(this.deps.pool, d, d + DAY_SECONDS);
          await storeArrivalDay(this.deps.pool, d, cells, sec());
        }),
        ...BLOCK_ARRIVAL_WINDOWS.map((w) => async () => {
          const from = midnight(sec()) - (BLOCK_ARRIVAL_WINDOW_DAYS[w] - 1) * DAY_SECONDS;
          const cells = await computeArrivalSpan(this.deps.pool, from, sec() + 1);
          await storeArrivalWindow(this.deps.pool, w, from, cells, sec());
        }),
      ];
      for (const unit of units) {
        const started = now();
        await unit();
        computed += 1;
        if ((await pacer.afterUnit(now() - started)) === "abort") {
          this.deps.log(`block arrival: paused after ${computed} units, ingestion is behind`);
          return { computed, aborted: true };
        }
      }
      if (days.length > 2) this.deps.log(`block arrival: computed ${days.length} days`);
      return { computed, aborted: false };
    } finally {
      this.#running = false;
    }
  }

  start(intervalMs = 10 * 60 * 1000): () => void {
    const run = (): void => {
      void this.refresh().catch((e: unknown) => {
        this.deps.log(`block arrival: pass failed, will retry — ${String(e)}`);
      });
    };
    run();
    const timer = setInterval(run, intervalMs);
    timer.unref();
    return () => clearInterval(timer);
  }
}
