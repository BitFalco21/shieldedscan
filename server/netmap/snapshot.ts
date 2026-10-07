import { createPool } from "../pg-pool";
import { loadRecentBlocks, type StoredBlock } from "./releases";
import "../pg-types";

/**
 * One read of the crawler's tables, taken whole so every route derives from the same rows (a
 * summary count and a map cell read seconds apart could disagree). Fresh for 30 s, then served
 * stale while one background read replaces it (`createSnapshotCache`); the routes are pure
 * functions over this object (`derive.ts`), testable against real rows without a network.
 *
 * The rows carry full addresses (needed to join and to hash) and nothing below this module may
 * serialise one. `derive.ts` reads `host`/`port` only through `anonId`/`subnet24`.
 */

/**
 * A node counts as answering when it answered a handshake within this window of the read.
 * Answers are intermittent, so a shorter window undercounts badly (three hours counts about half
 * of what a day does). Every tab reads the same window, so a hub on the topology is always a row
 * in the node list. Everything outside it is "not answering", true both of an address that never
 * answered and of one that last did days ago; the summary's `neverAnswered` is the only figure
 * that means never.
 */
export const REACHABLE_WINDOW_SEC = 24 * 60 * 60;
/** Enough finished crawls for seven days at a 10-minute cadence — the maturity rule's horizon. */
export const CRAWL_HISTORY_LIMIT = 1_008;

export interface LiveNodeRow {
  host: string;
  port: number;
  network: string;
  user_agent: string | null;
  protocol_version: number | null;
  /** The height the node declared in its last `version` message. */
  best_height: number | null;
  ping_ms: number | null;
  first_seen: number;
  last_reachable: number;
  country: string | null;
  city: string | null;
  lat: number | null;
  lon: number | null;
  asn: number | null;
  asn_org: string | null;
  tor_exit: boolean;
  reached: number;
  attempted: number;
}

export interface GhostNodeRow {
  host: string;
  port: number;
  network: string;
  tor_exit: boolean;
  country: string | null;
  lat: number | null;
  lon: number | null;
  last_error: string | null;
  last_attempt: number | null;
  /** Non-null on a node that answered once and has since gone quiet past the window. */
  last_reachable: number | null;
}

export interface LinkRow {
  from_host: string;
  from_port: number;
  to_host: string;
  to_port: number;
}

export interface CrawlRow {
  started_at: number;
  finished_at: number;
  attempted: number;
  reachable: number;
  new_nodes: number;
}

/** One stored line of the daily release record; '' and -1 are the table's "none declared". */
export interface ReleaseDayRow {
  day: string;
  user_agent: string;
  protocol_version: number;
  nodes: number;
  behind_tip: number;
  tip_unknown: number;
}

/** How many days of the release record a snapshot carries — the trend line's whole reach. */
export const RELEASE_HISTORY_DAYS = 400;

export interface NetmapSnapshot {
  /** Unix seconds the snapshot was taken at; every `asOf` reads this. */
  at: number;
  live: LiveNodeRow[];
  ghosts: GhostNodeRow[];
  /** Every advertisement FROM a live node, to any address we hold. */
  links: LinkRow[];
  /** Oldest first, the newest `CRAWL_HISTORY_LIMIT`. */
  crawls: CrawlRow[];
  crawlsTotal: number;
  firstCrawlStartedAt: number | null;
  /** Our follower's recent blocks with arrival stamps — the tip a node's height is held against. */
  recentBlocks: StoredBlock[];
  /** Oldest first; empty until the crawler has created and written the table. */
  releaseDays: ReleaseDayRow[];
}

export interface NetmapReader {
  read(): Promise<NetmapSnapshot>;
  close(): Promise<void>;
}

/** How long a snapshot is handed out without even starting a re-read. */
export const FRESH_MS = 30_000;
/**
 * How old a snapshot may be and still be served while a re-read runs. Past this a reader WAITS
 * on the read: a read that has failed for five minutes is an outage, and an outage must reach
 * the page as `DataUnavailable` rather than hide behind a snapshot forever. Every payload's
 * `asOf` reads the snapshot's own `at`, so a served-stale snapshot is dated, never disguised.
 */
export const STALE_MAX_MS = 5 * 60_000;

export interface SnapshotCache<T> {
  read(): Promise<T>;
}

/**
 * Stale-while-revalidate over one loader, single-flight.
 *
 * A rebuild can take over ten seconds (per-node probe totals over a large `net_probe`), longer
 * than the frontend's per-request timeout, so readers must not block on it. A reader is handed
 * the last snapshot at once and the re-read runs behind it; only a cold process, or a cache older
 * than `STALE_MAX_MS`, waits. A failed re-read keeps the last good snapshot and is never cached as
 * the answer.
 */
export function createSnapshotCache<T>(
  load: () => Promise<T>,
  now: () => number = Date.now,
  fresh = FRESH_MS,
  staleMax = STALE_MAX_MS,
): SnapshotCache<T> {
  let cached: { at: number; value: T } | null = null;
  let inflight: Promise<T> | null = null;
  const refresh = (): Promise<T> =>
    (inflight ??= load()
      .then((value) => {
        cached = { at: now(), value };
        return value;
      })
      .finally(() => {
        inflight = null;
      }));
  return {
    async read() {
      const age = cached ? now() - cached.at : Infinity;
      if (cached && age < fresh) return cached.value;
      const pending = refresh();
      if (cached && age < staleMax) {
        // Served stale; the refresh's outcome belongs to a later reader, so its rejection must
        // not become an unhandled one here.
        pending.catch(() => {});
        return cached.value;
      }
      return pending;
    },
  };
}

/**
 * The daily release record, oldest first. The table is the crawler's, created on its boot, so an
 * API that starts first finds it absent: that is an empty history, not a failed snapshot, rather
 * than losing every `/network` tab to a table only one tab reads.
 */
async function loadReleaseDays(
  pool: { query: ReturnType<typeof createPool>["query"] },
  at: number,
): Promise<ReleaseDayRow[]> {
  const exists = await pool.query<{ ok: boolean }>(
    `SELECT to_regclass('public.net_release_day') IS NOT NULL AS ok`,
  );
  if (!exists.rows[0]?.ok) return [];
  const { rows } = await pool.query<ReleaseDayRow>(
    `SELECT to_char(day, 'YYYY-MM-DD') AS day, user_agent, protocol_version, nodes, behind_tip,
            tip_unknown
     FROM net_release_day
     WHERE day >= (to_timestamp($1) AT TIME ZONE 'UTC')::date - $2::int
     ORDER BY day, nodes DESC, user_agent, protocol_version`,
    [at, RELEASE_HISTORY_DAYS],
  );
  return rows;
}

export function createNetmapReader(connection?: string): NetmapReader {
  const POOL = { max: 2, statement_timeout: 20_000 } as const;
  const pool = createPool(connection, POOL);
  async function load(): Promise<NetmapSnapshot> {
    const at = Math.floor(Date.now() / 1000);
    const since = at - REACHABLE_WINDOW_SEC;
    const [live, ghosts, links, crawls, crawlMeta, recentBlocks, releaseDays] = await Promise.all([
      pool.query<LiveNodeRow>(
        `SELECT n.host, n.port, n.network, n.user_agent, n.protocol_version, n.best_height,
                n.ping_ms,
                n.first_seen, n.last_reachable, n.country, n.city, n.lat, n.lon, n.asn, n.asn_org,
                n.tor_exit, COALESCE(p.reached, 0) AS reached, COALESCE(p.attempted, 0) AS attempted
         FROM net_node n
         LEFT JOIN LATERAL (
           SELECT count(*) FILTER (WHERE ok)::int AS reached, count(*)::int AS attempted
           FROM net_probe WHERE net_probe.host = n.host AND net_probe.port = n.port
         ) p ON true
         WHERE n.last_reachable IS NOT NULL AND n.last_reachable >= $1`,
        [since],
      ),
      pool.query<GhostNodeRow>(
        `SELECT host, port, network, tor_exit, country, lat, lon, last_error, last_attempt,
                last_reachable
         FROM net_node
         WHERE last_reachable IS NULL OR last_reachable < $1`,
        [since],
      ),
      pool.query<LinkRow>(
        `SELECT l.from_host, l.from_port, l.to_host, l.to_port
         FROM net_link l
         JOIN net_node a ON a.host = l.from_host AND a.port = l.from_port
         JOIN net_node b ON b.host = l.to_host AND b.port = l.to_port
         WHERE a.last_reachable IS NOT NULL AND a.last_reachable >= $1`,
        [since],
      ),
      pool.query<CrawlRow>(
        `SELECT started_at, finished_at, attempted, reachable, new_nodes
         FROM net_crawl WHERE finished_at IS NOT NULL
         ORDER BY id DESC LIMIT $1`,
        [CRAWL_HISTORY_LIMIT],
      ),
      pool.query<{ total: number; first_started_at: number | null }>(
        `SELECT count(*)::int AS total, min(started_at) AS first_started_at
         FROM net_crawl WHERE finished_at IS NOT NULL`,
      ),
      loadRecentBlocks(pool),
      loadReleaseDays(pool, at),
    ]);
    return {
      at,
      live: live.rows,
      ghosts: ghosts.rows,
      links: links.rows,
      crawls: crawls.rows.reverse(),
      crawlsTotal: crawlMeta.rows[0]?.total ?? 0,
      firstCrawlStartedAt: crawlMeta.rows[0]?.first_started_at ?? null,
      recentBlocks,
      releaseDays,
    };
  }

  const cache = createSnapshotCache(load);
  return { read: () => cache.read(), close: () => pool.end() };
}
