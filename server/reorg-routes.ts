import { Hono } from "hono";
import { Pool } from "pg";
import type {
  OrphanRateDay,
  OrphanRateSeries,
  OrphanRateWindow,
  OrphanRateWindowKey,
  ReorgEvent,
  ReorgSummary,
  ReorgWeekSeries,
  UpgradeNetwork,
} from "@/domain";
import { NU7, ORPHAN_RATE_DAYS } from "@/domain";
import type { CursorPage, CursorQuery } from "@/data/source";
import { decodeCursorForColumn, encodeCursor, INT8_SORT_KEY_MAX } from "@/data/cursor";
import { Cached } from "./cached";
import { createPool } from "./pg-pool";
import { clampPageSize } from "./page-size";
import "./pg-types";

/**
 * The observed-reorg log, read from the audit table the follower writes.
 *
 * Served from Postgres rather than the node because the node cannot answer it: Zakura does not
 * implement `getchaintips`, and even where that call exists it reports current tips, not a
 * history. The follower is the only witness of what it rolled back, and `reorg_event` records
 * it: one node's view, which is how the page frames it.
 */

const clampLimit = (raw: string | undefined, fallback: number): number =>
  clampPageSize(Number(raw), fallback);

interface ReorgRow {
  id: number;
  detected_at: number;
  height: number;
  depth: number;
  orphaned_hash: string;
  replaced_by: string;
}

function toEvent(row: ReorgRow): ReorgEvent {
  return {
    id: row.id,
    detectedAt: row.detected_at,
    height: row.height,
    depth: row.depth,
    orphanedHash: row.orphaned_hash,
    replacedBy: row.replaced_by,
  };
}

/**
 * A cursor's (detectedAt, id) tuple, or null (malformed means "first page").
 *
 * Both components are bound into SQL and both target `BIGINT`, so both need a range check: an
 * out-of-range bind parameter is a Postgres error, not an empty page. The id is checked here
 * because `decodeCursorForColumn` only vets the sort key.
 */
function parseCursor(raw: string | undefined): { sortKey: number; id: number } | null {
  const decoded = decodeCursorForColumn(raw, INT8_SORT_KEY_MAX);
  if (!decoded) return null;
  const id = Number(decoded.id);
  if (!Number.isFinite(id) || id < -1 || id > INT8_SORT_KEY_MAX) return null;
  return { sortKey: decoded.sortKey, id };
}

export async function listReorgEvents(
  pool: Pool,
  query: CursorQuery,
): Promise<CursorPage<ReorgEvent>> {
  const limit = clampLimit(String(query.limit), 25);
  const before = parseCursor(query.before);
  const after = parseCursor(query.after);

  // detected_at is not unique, so both predicates are row-value comparisons over the composite
  // (detected_at, id) tuple, matching the index.
  let rows: ReorgRow[];
  if (before) {
    ({ rows } = await pool.query<ReorgRow>(
      `SELECT * FROM reorg_event WHERE (detected_at, id) < ($1, $2)
        ORDER BY detected_at DESC, id DESC LIMIT $3`,
      [before.sortKey, before.id, limit],
    ));
  } else if (after) {
    const ascending = await pool.query<ReorgRow>(
      `SELECT * FROM reorg_event WHERE (detected_at, id) > ($1, $2)
        ORDER BY detected_at ASC, id ASC LIMIT $3`,
      [after.sortKey, after.id, limit],
    );
    rows = ascending.rows.reverse();
  } else {
    ({ rows } = await pool.query<ReorgRow>(
      `SELECT * FROM reorg_event ORDER BY detected_at DESC, id DESC LIMIT $1`,
      [limit],
    ));
  }

  const events = rows.map(toEvent);
  const first = events[0];
  const last = events[events.length - 1];
  const cursorOf = (event: ReorgEvent) => encodeCursor(event.detectedAt, String(event.id));
  return {
    items: events,
    // "Maybe more": a full page offers an older cursor; the worst case (a total that is an
    // exact multiple of the limit) is one empty final page, which the UI renders honestly.
    nextCursor: last !== undefined && events.length === limit ? cursorOf(last) : null,
    // The head page (no cursor) has nothing newer by definition.
    prevCursor: first !== undefined && (before ?? after) !== null ? cursorOf(first) : null,
  };
}

export async function getReorgSummary(pool: Pool): Promise<ReorgSummary> {
  const [aggregate, meta] = await Promise.all([
    pool.query<{ observed: number; deepest: number | null }>(
      `SELECT COUNT(*)::bigint AS observed, MAX(depth)::int AS deepest FROM reorg_event`,
    ),
    pool.query<{ observing_since: number }>(`SELECT observing_since FROM reorg_observation`),
  ]);
  const since = meta.rows[0]?.observing_since;
  if (since === undefined) {
    // The meta row is written by applySchema; its absence means the schema never ran here.
    throw new Error("reorg_observation is empty — schema not applied");
  }
  return {
    observedCount: aggregate.rows[0]?.observed ?? 0,
    deepestDepth: aggregate.rows[0]?.deepest ?? null,
    observingSince: since,
  };
}

export const REORG_WEEKS_PATH = "/chain/reorgs/weekly";

/**
 * Reorganisations per ISO week (Monday, UTC), every week from the one observation began in to the
 * current one. A week with none is a zero only because the follower was watching: no week before
 * `observingSince` exists here, so an unobserved stretch can never read as a quiet one.
 */
export async function loadReorgWeeks(pool: Pool): Promise<ReorgWeekSeries> {
  const meta = await pool.query<{ observing_since: number }>(
    "SELECT observing_since FROM reorg_observation",
  );
  const since = meta.rows[0]?.observing_since;
  if (since === undefined) return { observingSince: null, weeks: [] };
  const { rows } = await pool.query<{ ts: string; reorgs: number; deepest: number }>(
    `SELECT EXTRACT(EPOCH FROM w)::bigint AS ts,
            count(e.id)::int AS reorgs,
            COALESCE(max(e.depth), 0)::int AS deepest
       FROM generate_series(
              date_trunc('week', to_timestamp($1) AT TIME ZONE 'UTC'),
              date_trunc('week', now() AT TIME ZONE 'UTC'),
              interval '1 week') AS w
       LEFT JOIN reorg_event e
              ON e.detected_at >= EXTRACT(EPOCH FROM w)
             AND e.detected_at <  EXTRACT(EPOCH FROM w + interval '1 week')
      GROUP BY w
      ORDER BY w`,
    [since],
  );
  return {
    observingSince: Number(since),
    weeks: rows.map((r) => ({ timestamp: Number(r.ts), reorgs: r.reorgs, deepest: r.deepest })),
  };
}

export const ORPHAN_RATE_PATH = "/chain/reorgs/orphan-rate";

const DAY = 86_400;

/** The upgrade the before/since windows split at, on `network`; null where none is scheduled. */
export function orphanRateUpgrade(
  network: UpgradeNetwork,
): { name: string; height: number } | null {
  const height = NU7.activationHeight[network];
  return height === null ? null : { name: NU7.name, height };
}

/**
 * Orphans per height this node rolled back, from when observation began. A depth-n row discarded
 * n blocks at `height` .. `height + n - 1`, so it is n orphans, each at its own height.
 */
const ORPHAN_HEIGHTS_CTE = `
  orphan_heights AS (
    SELECT h, count(*)::int AS n
      FROM reorg_event e
     CROSS JOIN LATERAL generate_series(e.height, e.height + e.depth - 1) AS h
     WHERE e.detected_at >= $1
     GROUP BY h
  )`;

/**
 * Each window as a predicate over the counted blocks: $2 is now, $3 the upgrade height. The
 * trailing windows are by header time, the upgrade pair by height; every one starts no earlier
 * than observation, which the CTE already bounds.
 */
const WINDOW_PREDICATES: readonly (readonly [OrphanRateWindowKey, string])[] = [
  ["24h", `timestamp > $2::bigint - ${DAY}`],
  ["7d", `timestamp > $2::bigint - ${7 * DAY}`],
  ["30d", `timestamp > $2::bigint - ${30 * DAY}`],
  ["before-upgrade", "height < $3::int"],
  ["since-upgrade", "height >= $3::int"],
];

/**
 * The observed orphan rate: every UTC day of the last `ORPHAN_RATE_DAYS` observation covers, and
 * the trailing and before/since-upgrade windows.
 *
 * One clock for both counts: an orphan is filed under the height it competed for, and a height
 * under its canonical block's header time. A reorg detected just after midnight for a block mined
 * before it therefore stays with that block's day, and the upgrade split is by height. An orphan
 * whose height holds no canonical block (a rollback the node has not re-extended yet) waits for it.
 * Nothing before `observing_since` is counted on either side: a day before it is absent, not 0.
 */
export async function loadOrphanRate(
  pool: Pool,
  opts: { upgrade: { name: string; height: number } | null; nowSec?: number },
): Promise<OrphanRateSeries> {
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const meta = await pool.query<{ observing_since: string }>(
    "SELECT observing_since FROM reorg_observation",
  );
  const sinceRaw = meta.rows[0]?.observing_since;
  if (sinceRaw === undefined) throw new Error("reorg_observation is empty — schema not applied");
  const since = Number(sinceRaw);
  const today = Math.floor(now / DAY) * DAY;
  const firstDay = Math.max(today - (ORPHAN_RATE_DAYS - 1) * DAY, Math.floor(since / DAY) * DAY);
  const upgradeHeight = opts.upgrade?.height ?? null;

  const [daily, windows, activated] = await Promise.all([
    // A block stamped past the end of today (a miner's clock ahead) waits for its day.
    pool.query<{ day: string; blocks: number; orphans: number }>(
      `WITH ${ORPHAN_HEIGHTS_CTE}
       SELECT (b.timestamp / 86400) * 86400 AS day,
              count(*)::int AS blocks,
              COALESCE(sum(o.n), 0)::int AS orphans
         FROM block b
         LEFT JOIN orphan_heights o ON o.h = b.height
        WHERE b.timestamp >= GREATEST($1::bigint, $2::bigint) AND b.timestamp < $3
        GROUP BY 1`,
      [since, firstDay, today + DAY],
    ),
    pool.query<Record<string, string | number | null>>(
      `WITH ${ORPHAN_HEIGHTS_CTE},
       counted AS (
         SELECT b.height, b.timestamp, COALESCE(o.n, 0) AS orphans
           FROM block b
           LEFT JOIN orphan_heights o ON o.h = b.height
          WHERE b.timestamp >= $1
       )
       SELECT ${WINDOW_PREDICATES.map(
         ([key, predicate]) => `
         count(*) FILTER (WHERE ${predicate})::int AS "${key}_blocks",
         COALESCE(sum(orphans) FILTER (WHERE ${predicate}), 0)::int AS "${key}_orphans",
         min(timestamp) FILTER (WHERE ${predicate}) AS "${key}_first",
         max(timestamp) FILTER (WHERE ${predicate}) AS "${key}_last"`,
       ).join(",")}
         FROM counted`,
      [since, now, upgradeHeight],
    ),
    upgradeHeight === null
      ? Promise.resolve(null)
      : pool.query<{ timestamp: string }>("SELECT timestamp FROM block WHERE height = $1", [
          upgradeHeight,
        ]),
  ]);

  const byDay = new Map(daily.rows.map((r) => [Number(r.day), r]));
  const days: OrphanRateDay[] = [];
  for (let ts = firstDay; ts <= today; ts += DAY) {
    const row = byDay.get(ts);
    days.push({
      timestamp: ts,
      orphans: row?.orphans ?? 0,
      blocks: row?.blocks ?? 0,
      partial: ts === today || since > ts,
    });
  }

  const row = windows.rows[0] ?? {};
  const num = (v: string | number | null | undefined) =>
    v === null || v === undefined ? null : Number(v);
  const keys = opts.upgrade === null ? WINDOW_PREDICATES.slice(0, 3) : WINDOW_PREDICATES;
  const spans: OrphanRateWindow[] = keys.map(([key]) => ({
    key,
    orphans: num(row[`${key}_orphans`]) ?? 0,
    blocks: num(row[`${key}_blocks`]) ?? 0,
    firstBlockAt: num(row[`${key}_first`]),
    lastBlockAt: num(row[`${key}_last`]),
  }));

  const activatedAt = activated?.rows[0]?.timestamp;
  return {
    observingSince: since,
    asOf: now,
    upgrade:
      opts.upgrade === null
        ? null
        : { ...opts.upgrade, activatedAt: activatedAt === undefined ? null : Number(activatedAt) },
    days,
    windows: spans,
  };
}

export function reorgRoutes(
  connection?: string,
  opts: { network?: UpgradeNetwork; pool?: Pool } = {},
): Hono {
  // A statement_timeout, as on the analytics pool: a query with no deadline holds a connection
  // indefinitely, which on a small pool is indistinguishable from an outage. These reads are
  // small, so the bound is tight.
  const pool = opts.pool ?? createPool(connection, { max: 4, statement_timeout: 15_000 });
  const app = new Hono();
  const upgrade = orphanRateUpgrade(opts.network ?? "mainnet");
  // A minute fresh, and a few more served while the next read runs: one read scans every block
  // since observation began, and the rate moves by a block at a time.
  const orphanRate = new Cached<OrphanRateSeries>(60_000, { staleMs: 4 * 60_000 });

  app.get("/chain/reorgs", async (c) => {
    const { before, after, limit } = c.req.query();
    return c.json(
      await listReorgEvents(pool, {
        before: before || undefined,
        after: after || undefined,
        limit: clampLimit(limit, 25),
      }),
    );
  });

  app.get("/chain/reorgs/summary", async (c) => c.json(await getReorgSummary(pool)));
  app.get(REORG_WEEKS_PATH, async (c) => c.json(await loadReorgWeeks(pool)));
  app.get(ORPHAN_RATE_PATH, async (c) =>
    c.json(await orphanRate.get(() => loadOrphanRate(pool, { upgrade }))),
  );

  return app;
}
