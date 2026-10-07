import { Hono } from "hono";
import { Pool } from "pg";
import type { ReorgEvent, ReorgSummary } from "@/domain";
import type { CursorPage, CursorQuery } from "@/data/source";
import { decodeCursorForColumn, encodeCursor, INT8_SORT_KEY_MAX } from "@/data/cursor";
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

export function reorgRoutes(connection?: string): Hono {
  // A statement_timeout, as on the analytics pool: a query with no deadline holds a connection
  // indefinitely, which on a small pool is indistinguishable from an outage. These reads are
  // small, so the bound is tight.
  const pool = createPool(connection, { max: 4, statement_timeout: 15_000 });
  const app = new Hono();

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

  return app;
}
