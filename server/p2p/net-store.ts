import { readFileSync } from "node:fs";
import type { Pool, PoolClient } from "pg";
import type { ParsedVersion, PeerNetwork } from "./codec";
import { createPool, rollbackQuietly } from "../pg-pool";
import "../pg-types";
import { utcDayFromSeconds } from "@/domain/time";
import { REACHABLE_WINDOW_SEC } from "../netmap/snapshot";
import { loadRecentBlocks, rawReleaseGroups, type ReleaseInput } from "../netmap/releases";

/**
 * The crawler's Postgres writer. Schema in `server/schema-net.sql`, applied here on boot: the
 * crawler is this schema's only writer, and the API's netmap routes only read.
 *
 * Everything is written idempotently and keyed on (host, port): a cycle that dies mid-way
 * re-records the same facts on the next pass, and an upsert of the same probe is a no-op.
 */

export interface NodeIdentity {
  host: string;
  port: number;
  network: PeerNetwork;
}

export interface ProbeOutcome {
  ok: boolean;
  /** TCP-connect-to-verack, from our vantage point; null when the handshake never finished. */
  pingMs: number | null;
  version: ParsedVersion | null;
  /** Why a failed probe failed (socket error text / "timed out"); null on success. */
  error?: string | null;
}

export interface CrawlTotals {
  finishedAt: number;
  attempted: number;
  reachable: number;
  newNodes: number;
}

const POOL = { max: 2, statement_timeout: 60_000 } as const;

/** Postgres's SQLSTATE for a deadlock: it aborted this statement to let the other one finish. */
const DEADLOCK = "40P01";
const DEADLOCK_RETRIES = 2;

/**
 * Runs an idempotent write, retrying when Postgres chose it as a deadlock victim. Every write
 * here is an upsert or a keyed update, so a retry records the same facts; without it, a probe
 * that lost a deadlock would be silently missing from that cycle.
 */
export async function retryOnDeadlock<T>(write: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await write();
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      if (code !== DEADLOCK || attempt >= DEADLOCK_RETRIES) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50 + Math.random() * 200));
    }
  }
}

export class NetStore {
  readonly #pool: Pool;

  constructor(connection?: string) {
    this.#pool = createPool(connection, POOL);
  }

  async applySchema(path: string): Promise<void> {
    await this.#pool.query(readFileSync(path, "utf8"));
  }

  /**
   * The addresses to dial this cycle, at most `limit`: nodes that have answered come first, then
   * the most recently advertised. Torv3 rows are recorded but never dialled (no Tor client). The
   * cap keeps a peer that gossips thousands of invented addresses from crowding out real nodes or
   * turning the crawler into a scanner.
   */
  async dialableNodes(limit: number): Promise<NodeIdentity[]> {
    const { rows } = await this.#pool.query<NodeIdentity>(
      `SELECT host, port, network FROM net_node WHERE network IN ('ipv4', 'ipv6')
       ORDER BY last_reachable DESC NULLS LAST, last_seen DESC
       LIMIT $1`,
      [limit],
    );
    return rows;
  }

  async beginCrawl(startedAt: number): Promise<number> {
    const { rows } = await this.#pool.query<{ id: number }>(
      `INSERT INTO net_crawl (started_at) VALUES ($1) RETURNING id`,
      [startedAt],
    );
    return rows[0]!.id;
  }

  async finishCrawl(id: number, totals: CrawlTotals): Promise<void> {
    await this.#pool.query(
      `UPDATE net_crawl SET finished_at = $2, attempted = $3, reachable = $4, new_nodes = $5
       WHERE id = $1`,
      [id, totals.finishedAt, totals.attempted, totals.reachable, totals.newNodes],
    );
  }

  /**
   * Records addresses as SEEN — advertised by a peer, resolved from a DNS seeder, or handed
   * in as config. Returns how many were new. When `advertisedBy` is set the gossip edge is
   * recorded too; a seeder is not a peer, so DNS results carry no edge.
   */
  async recordSeen(
    seenAt: number,
    entries: NodeIdentity[],
    advertisedBy?: { host: string; port: number },
  ): Promise<number> {
    // Gossip legitimately repeats an address inside one message, and ON CONFLICT DO UPDATE
    // refuses to touch the same row twice in one statement — so the batch is deduped first.
    const unique = new Map<string, NodeIdentity>();
    for (const e of entries) unique.set(`${e.host}:${e.port}`, e);
    // Sorted, so two concurrent batches lock their shared rows in the same order and cannot
    // deadlock each other.
    const deduped = [...unique.values()].sort((a, b) =>
      a.host === b.host ? a.port - b.port : a.host < b.host ? -1 : 1,
    );
    if (deduped.length === 0) return 0;
    const hosts = deduped.map((e) => e.host);
    const ports = deduped.map((e) => e.port);
    const networks = deduped.map((e) => e.network);
    const { rows } = await retryOnDeadlock(() =>
      this.#pool.query<{ inserted: boolean }>(
        `INSERT INTO net_node (host, port, network, first_seen, last_seen)
         SELECT u.h, u.p, u.n, $4::bigint, $4::bigint
         FROM unnest($1::text[], $2::int[], $3::text[]) WITH ORDINALITY AS u(h, p, n, i)
         ORDER BY u.i
         ON CONFLICT (host, port) DO UPDATE SET last_seen = GREATEST(net_node.last_seen, $4)
         RETURNING (xmax = 0) AS inserted`,
        [hosts, ports, networks, seenAt],
      ),
    );
    if (advertisedBy) {
      await retryOnDeadlock(() =>
        this.#pool.query(
          `INSERT INTO net_link (from_host, from_port, to_host, to_port, last_advertised)
         SELECT $1, $2, h, p, $5 FROM unnest($3::text[], $4::int[]) AS u(h, p)
         ON CONFLICT (from_host, from_port, to_host, to_port)
         DO UPDATE SET last_advertised = GREATEST(net_link.last_advertised, $5)`,
          [advertisedBy.host, advertisedBy.port, hosts, ports, seenAt],
        ),
      );
    }
    return rows.filter((r) => r.inserted).length;
  }

  /** One probe's outcome: the per-cycle row plus the node's own running fields. */
  async recordProbe(
    crawlId: number,
    node: NodeIdentity,
    at: number,
    outcome: ProbeOutcome,
  ): Promise<void> {
    await retryOnDeadlock(() =>
      this.#pool.query(
        `INSERT INTO net_probe (crawl_id, host, port, at, ok, ping_ms)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (crawl_id, host, port) DO NOTHING`,
        [crawlId, node.host, node.port, at, outcome.ok, outcome.pingMs],
      ),
    );
    if (outcome.ok && outcome.version) {
      const v = outcome.version;
      await retryOnDeadlock(() =>
        this.#pool.query(
          `UPDATE net_node SET last_attempt = $3, last_reachable = $3, last_seen = $3,
           ping_ms = $4, user_agent = $5, protocol_version = $6, services = $7, best_height = $8,
           last_error = NULL
         WHERE host = $1 AND port = $2`,
          [
            node.host,
            node.port,
            at,
            outcome.pingMs,
            v.userAgent,
            v.protocolVersion,
            // A u64 bitfield; sent as text so a hostile 2^63 flag set cannot round through
            // a JS number on the way in.
            v.services.toString(),
            v.startHeight,
          ],
        ),
      );
    } else {
      await retryOnDeadlock(() =>
        this.#pool.query(
          `UPDATE net_node SET last_attempt = $3, last_error = $4 WHERE host = $1 AND port = $2`,
          // Socket error text is OS-generated, not peer-chosen, but it is capped anyway.
          [node.host, node.port, at, (outcome.error ?? "handshake incomplete").slice(0, 120)],
        ),
      );
    }
  }

  /**
   * The GeoIP/ASN pass: one SQL join against the local range tables for every clearnet node
   * not yet checked. `geo_checked_at` is stamped even when the lookup finds nothing — checked
   * and unknown is an answer — and the refresh script NULLs the stamp after loading new range
   * tables, which is what re-enriches everything. A NULL location stays NULL; nothing is
   * fabricated. Returns how many rows were checked.
   */
  async enrichPending(now: number): Promise<number> {
    const { rows } = await this.#pool.query<{ geo: boolean; asn: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM net_geo_block) AS geo,
              EXISTS (SELECT 1 FROM net_asn_block) AS asn`,
    );
    // No range tables loaded yet: skip rather than stamping every node "checked, nothing
    // found" against an empty table. The refresh script's stamp-clearing covers the upgrade
    // path; this guard covers the fresh install.
    if (!rows[0]!.geo && !rows[0]!.asn) return 0;
    const result = await retryOnDeadlock(() =>
      this.#pool.query(
        `UPDATE net_node n
       SET lat = sub.lat, lon = sub.lon, country = sub.country, city = sub.city,
           asn = sub.asn, asn_org = sub.asn_org, geo_checked_at = $1
       FROM (
         SELECT n2.host, n2.port, g.lat, g.lon, l.country, l.city, a.asn, a.asn_org
         FROM net_node n2
         LEFT JOIN net_geo_block g ON g.network >>= n2.host::inet
         LEFT JOIN net_geo_location l ON l.geoname_id = g.geoname_id
         LEFT JOIN net_asn_block a ON a.network >>= n2.host::inet
         WHERE n2.network IN ('ipv4', 'ipv6') AND n2.geo_checked_at IS NULL
       ) sub
       WHERE n.host = sub.host AND n.port = sub.port`,
        [now],
      ),
    );
    return result.rowCount ?? 0;
  }

  /**
   * Today's line of the daily release record: the answering nodes grouped by raw user agent
   * and declared protocol version, with how many were behind our tip. The UTC day's rows are
   * REPLACED whole in one transaction, so a group that stopped answering since the last cycle
   * leaves the record instead of lingering, and the day's last cycle is the day's record.
   * Returns how many groups were written.
   */
  async recordReleaseDay(now: number): Promise<number> {
    const day = utcDayFromSeconds(now);
    const [live, blocks] = await Promise.all([
      this.#pool.query<ReleaseInput>(
        `SELECT user_agent, protocol_version, best_height, last_reachable
         FROM net_node WHERE last_reachable IS NOT NULL AND last_reachable >= $1`,
        [now - REACHABLE_WINDOW_SEC],
      ),
      loadRecentBlocks(this.#pool),
    ]);
    const groups = rawReleaseGroups(live.rows, blocks);
    await this.#inTransaction(async (client) => {
      await client.query(`DELETE FROM net_release_day WHERE day = $1::date`, [day]);
      if (groups.length > 0) {
        await client.query(
          `INSERT INTO net_release_day
             (day, user_agent, protocol_version, nodes, behind_tip, tip_unknown)
           SELECT $1::date, u.ua, u.pv, u.n, u.b, u.t
           FROM unnest($2::text[], $3::int[], $4::int[], $5::int[], $6::int[])
             AS u(ua, pv, n, b, t)`,
          [
            day,
            groups.map((g) => g.userAgent ?? ""),
            groups.map((g) => g.protocolVersion ?? -1),
            groups.map((g) => g.nodes),
            groups.map((g) => g.behindTip),
            groups.map((g) => g.tipUnknown),
          ],
        );
      }
    });
    return groups.length;
  }

  /** Replaces the Tor exit list whole and re-flags every node — stale exits must not linger. */
  async replaceTorExits(ips: string[], fetchedAt: number): Promise<void> {
    await retryOnDeadlock(() =>
      this.#inTransaction(async (client) => {
        await client.query(`DELETE FROM net_tor_exit`);
        if (ips.length > 0) {
          await client.query(
            `INSERT INTO net_tor_exit (ip, fetched_at)
           SELECT DISTINCT ip, $2::bigint FROM unnest($1::text[]) AS u(ip)`,
            [ips, fetchedAt],
          );
        }
        // Only rows whose flag changes, so the refresh does not lock every node the crawl is
        // writing to at the same moment.
        await client.query(
          `UPDATE net_node
         SET tor_exit = EXISTS (SELECT 1 FROM net_tor_exit t WHERE t.ip = net_node.host)
         WHERE tor_exit IS DISTINCT FROM
           EXISTS (SELECT 1 FROM net_tor_exit t WHERE t.ip = net_node.host)`,
        );
      }),
    );
  }

  /**
   * Bounded growth: probes past their window, gossip edges nobody has repeated, and nodes
   * that were never reachable and have not been advertised for the keep window — gossip
   * carries garbage addresses, and keeping them forever probes them forever.
   */
  async prune(now: number, keep: { probeSeconds: number; nodeSeconds: number }): Promise<void> {
    await this.#pool.query(`DELETE FROM net_probe WHERE at < $1`, [now - keep.probeSeconds]);
    await this.#pool.query(`DELETE FROM net_link WHERE last_advertised < $1`, [
      now - keep.nodeSeconds,
    ]);
    await this.#pool.query(`DELETE FROM net_node WHERE last_reachable IS NULL AND last_seen < $1`, [
      now - keep.nodeSeconds,
    ]);
  }

  /** Runs `work` in one transaction on one client, rolled back if it throws. */
  async #inTransaction(work: (client: PoolClient) => Promise<void>): Promise<void> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      await work(client);
      await client.query("COMMIT");
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }
}
