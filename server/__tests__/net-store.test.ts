import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { NetStore, type NodeIdentity } from "../p2p/net-store";
import type { ParsedVersion } from "../p2p/codec";

/**
 * The crawler store against a real database (an in-memory path runs no SQL). Skips without
 * TEST_DATABASE_URL; run it as the other DB suites do.
 */
const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

// Its own database, created here — vitest runs test files in parallel against one server, so a
// shared `explorer` database has two crawler suites truncating each other's rows mid-test.
const TEST_DB = "net_store_test";
function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

const version = (over: Partial<ParsedVersion> = {}): ParsedVersion => ({
  protocolVersion: 170_160,
  services: 1n,
  timestampSec: 1_757_000_000,
  userAgent: "/Zebra:6.3.0/",
  startHeight: 3_500_000,
  ...over,
});

const node = (host: string): NodeIdentity => ({ host, port: 8233, network: "ipv4" });

describeDb("NetStore", () => {
  // Guarded: describe.skip still runs this body to register skipped tests, so it must not
  // touch an undefined DATABASE_URL at collection time.
  const dbUrl = DATABASE_URL ? withDatabase(DATABASE_URL, TEST_DB) : "";
  let store: NetStore;
  let pool: Pool;

  beforeAll(async () => {
    const admin = new Pool({ connectionString: withDatabase(DATABASE_URL!, "postgres"), max: 1 });
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
      await admin.query(`CREATE DATABASE ${TEST_DB}`);
    } finally {
      await admin.end();
    }
    store = new NetStore(dbUrl);
    pool = new Pool({ connectionString: dbUrl });
    await store.applySchema(join(process.cwd(), "server", "schema-net.sql"));
  });

  beforeEach(async () => {
    await pool.query(
      `DELETE FROM net_probe; DELETE FROM net_link; DELETE FROM net_crawl;
       DELETE FROM net_node; DELETE FROM net_geo_block; DELETE FROM net_geo_location;
       DELETE FROM net_asn_block; DELETE FROM net_release_day; DELETE FROM net_asn_day;`,
    );
  });

  afterAll(async () => {
    await store.close();
    await pool.end();
  });

  it("carries the per-node probe index the node map's lateral join depends on", async () => {
    const { rows } = await pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'net_probe'`,
    );
    expect(rows.map((r) => r.indexname)).toContain("net_probe_node_idx");
  });

  it("counts only genuinely new addresses, and dedupes within one batch", async () => {
    const first = await store.recordSeen(100, [node("8.8.8.8"), node("1.1.1.1"), node("8.8.8.8")]);
    expect(first).toBe(2); // the duplicate in-batch collapses
    const second = await store.recordSeen(200, [node("8.8.8.8"), node("9.9.9.9")]);
    expect(second).toBe(1); // 8.8.8.8 already known
  });

  it("records a gossip edge only when an advertiser is given", async () => {
    await store.recordSeen(100, [node("8.8.8.8")]); // seeder, no edge
    await store.recordSeen(200, [node("1.1.1.1")], { host: "8.8.8.8", port: 8233 });
    const { rows } = await pool.query(`SELECT from_host, to_host FROM net_link`);
    expect(rows).toEqual([{ from_host: "8.8.8.8", to_host: "1.1.1.1" }]);
  });

  it("a reachable probe stamps last_reachable and the peer's claims; a failure only attempts", async () => {
    await store.recordSeen(100, [node("8.8.8.8"), node("1.1.1.1")]);
    const crawl = await store.beginCrawl(150);
    await store.recordProbe(crawl, node("8.8.8.8"), 160, {
      ok: true,
      pingMs: 12,
      version: version({ userAgent: "/Zakura:1.2.0/" }),
    });
    await store.recordProbe(crawl, node("1.1.1.1"), 160, {
      ok: false,
      pingMs: null,
      version: null,
      error: "connect ECONNREFUSED",
    });
    const { rows } = await pool.query(
      `SELECT host, last_reachable, last_attempt, user_agent, ping_ms, last_error
       FROM net_node ORDER BY host`,
    );
    expect(rows).toEqual([
      {
        host: "1.1.1.1",
        last_reachable: null,
        last_attempt: 160,
        user_agent: null,
        ping_ms: null,
        last_error: "connect ECONNREFUSED",
      },
      {
        host: "8.8.8.8",
        last_reachable: 160,
        last_attempt: 160,
        user_agent: "/Zakura:1.2.0/",
        ping_ms: 12,
        last_error: null,
      },
    ]);
    // A later success clears the recorded failure — the column describes the LAST probe.
    await store.recordProbe(crawl + 1, node("1.1.1.1"), 170, {
      ok: true,
      pingMs: 9,
      version: version(),
    });
    const again = await pool.query(`SELECT last_error FROM net_node WHERE host = '1.1.1.1'`);
    expect(again.rows[0]!.last_error).toBeNull();
  });

  it("a full refusal stamps last_full; later probes and a re-applied schema never erase it", async () => {
    await store.recordSeen(100, [node("9.9.9.9")]);
    const crawl = await store.beginCrawl(150);
    await store.recordProbe(crawl, node("9.9.9.9"), 160, {
      ok: false,
      pingMs: null,
      version: null,
      error: "full: closed on connect",
      full: true,
    });
    const read = async () =>
      (
        await pool.query(
          `SELECT last_full, last_error, last_reachable FROM net_node WHERE host = '9.9.9.9'`,
        )
      ).rows[0];
    expect(await read()).toEqual({
      last_full: 160,
      last_error: "full: closed on connect",
      last_reachable: null,
    });
    // A later ordinary failure records its own error and keeps when the node was last full.
    await store.recordProbe(crawl + 1, node("9.9.9.9"), 170, {
      ok: false,
      pingMs: null,
      version: null,
      error: "timed out",
    });
    expect(await read()).toMatchObject({ last_full: 160, last_error: "timed out" });
    // A success keeps it too: the column says when it was last full, not what it is now.
    await store.recordProbe(crawl + 2, node("9.9.9.9"), 180, {
      ok: true,
      pingMs: 7,
      version: version(),
    });
    expect(await read()).toMatchObject({ last_full: 160, last_reachable: 180 });
    // The crawler re-applies the schema on every start; that must leave the data alone.
    await store.applySchema(join(process.cwd(), "server", "schema-net.sql"));
    expect(await read()).toMatchObject({ last_full: 160, last_reachable: 180 });
  });

  it("uptime is reached/attempted out of net_probe — one fact, one place", async () => {
    await store.recordSeen(100, [node("8.8.8.8")]);
    for (let i = 0; i < 4; i += 1) {
      const crawl = await store.beginCrawl(100 + i);
      await store.recordProbe(crawl, node("8.8.8.8"), 100 + i, {
        ok: i < 3, // reachable 3 of 4 cycles
        pingMs: i < 3 ? 10 : null,
        version: i < 3 ? version() : null,
      });
    }
    const { rows } = await pool.query<{ reached: number; attempted: number }>(
      `SELECT count(*) FILTER (WHERE ok) AS reached, count(*) AS attempted
       FROM net_probe WHERE host = '8.8.8.8'`,
    );
    expect(Number(rows[0]!.reached)).toBe(3);
    expect(Number(rows[0]!.attempted)).toBe(4);
  });

  it("enrichment joins the range tables and stamps checked, leaving an unmatched node NULL", async () => {
    await store.recordSeen(100, [node("1.2.3.4"), node("203.0.113.9")]);
    await pool.query(
      `INSERT INTO net_geo_block (network, geoname_id, lat, lon)
       VALUES ('1.2.3.0/24', 42, 52.5, 13.4)`,
    );
    await pool.query(
      `INSERT INTO net_geo_location (geoname_id, country, city) VALUES (42, 'DE', 'Berlin')`,
    );
    await pool.query(
      `INSERT INTO net_asn_block (network, asn, asn_org) VALUES ('1.2.3.0/24', 24940, 'Hetzner')`,
    );
    const checked = await store.enrichPending(500);
    expect(checked).toBe(2);
    const { rows } = await pool.query(
      `SELECT host, country, asn_org, geo_checked_at FROM net_node ORDER BY host`,
    );
    // Matched node gets its facts; the unmatched one is stamped-checked but stays NULL —
    // never a fabricated location.
    expect(rows).toEqual([
      { host: "1.2.3.4", country: "DE", asn_org: "Hetzner", geo_checked_at: 500 },
      { host: "203.0.113.9", country: null, asn_org: null, geo_checked_at: 500 },
    ]);
  });

  it("enrichment is a no-op while no range tables are loaded", async () => {
    await store.recordSeen(100, [node("1.2.3.4")]);
    expect(await store.enrichPending(500)).toBe(0);
    const { rows } = await pool.query(`SELECT geo_checked_at FROM net_node`);
    expect(rows[0]!.geo_checked_at).toBeNull();
  });

  it("the Tor exit list replaces whole and re-flags matching nodes", async () => {
    await store.recordSeen(100, [node("185.220.101.5"), node("8.8.8.8")]);
    await store.replaceTorExits(["185.220.101.5"], 200);
    let { rows } = await pool.query(`SELECT host, tor_exit FROM net_node ORDER BY host`);
    expect(rows).toEqual([
      { host: "185.220.101.5", tor_exit: true },
      { host: "8.8.8.8", tor_exit: false },
    ]);
    // A replace that no longer lists an IP must un-flag it — stale exits must not linger.
    await store.replaceTorExits(["9.9.9.9"], 300);
    ({ rows } = await pool.query(
      `SELECT host, tor_exit FROM net_node WHERE host = '185.220.101.5'`,
    ));
    expect(rows[0]!.tor_exit).toBe(false);
  });

  it("prune drops old probes, stale edges and never-reachable stale nodes", async () => {
    await store.recordSeen(1_000, [node("8.8.8.8")]); // never reachable, old
    await store.recordSeen(1_000, [node("1.1.1.1")], { host: "8.8.8.8", port: 8233 });
    const crawl = await store.beginCrawl(1_000);
    // 1.1.1.1 is reachable and recent, so it must survive.
    await store.recordProbe(crawl, node("1.1.1.1"), 9_999_500, {
      ok: true,
      pingMs: 5,
      version: version(),
    });
    await store.recordProbe(crawl, node("8.8.8.8"), 1_000, {
      ok: false,
      pingMs: null,
      version: null,
    });
    await store.prune(10_000_000, { probeSeconds: 1_000, nodeSeconds: 1_000 });
    const nodes = await pool.query<{ host: string }>(`SELECT host FROM net_node ORDER BY host`);
    expect(nodes.rows.map((r) => r.host)).toEqual(["1.1.1.1"]);
    const probes = await pool.query(`SELECT count(*)::int AS n FROM net_probe`);
    expect(probes.rows[0]!.n).toBe(1); // only the recent reachable probe remains
  });
  it("records a day's release line, replacing the day whole and leaving other days alone", async () => {
    const day = 1_790_000_000; // 2026-09-21 UTC
    await store.recordSeen(day, [node("1.1.1.1"), node("8.8.4.4")]);
    const crawl = await store.beginCrawl(day);
    await store.recordProbe(crawl, node("1.1.1.1"), day, {
      ok: true,
      pingMs: 5,
      version: version(),
    });
    await store.recordProbe(crawl, node("8.8.4.4"), day, {
      ok: true,
      pingMs: 5,
      version: version({ userAgent: "", protocolVersion: 170_190 }),
    });
    await pool.query(
      `INSERT INTO net_release_day VALUES ('2026-09-20', '/Zebra:6.2.3/', 170160, 4, 0, 0)`,
    );
    expect(await store.recordReleaseDay(day)).toBe(2);
    // No chain tables in this database, so every lag is unknown rather than the write failing.
    const first = await pool.query(
      `SELECT to_char(day, 'YYYY-MM-DD') AS day, user_agent, protocol_version, nodes,
              behind_tip, tip_unknown
       FROM net_release_day ORDER BY day, user_agent`,
    );
    expect(first.rows).toEqual([
      {
        day: "2026-09-20",
        user_agent: "/Zebra:6.2.3/",
        protocol_version: 170160,
        nodes: 4,
        behind_tip: 0,
        tip_unknown: 0,
      },
      {
        day: "2026-09-21",
        user_agent: "",
        protocol_version: 170190,
        nodes: 1,
        behind_tip: 0,
        tip_unknown: 1,
      },
      {
        day: "2026-09-21",
        user_agent: "/Zebra:6.3.0/",
        protocol_version: 170160,
        nodes: 1,
        behind_tip: 0,
        tip_unknown: 1,
      },
    ]);
    // A node stops answering: the day's next line drops its group instead of keeping it.
    await pool.query(`UPDATE net_node SET last_reachable = 1 WHERE host = '8.8.4.4'`);
    expect(await store.recordReleaseDay(day + 600)).toBe(1);
    const second = await pool.query(
      `SELECT to_char(day, 'YYYY-MM-DD') AS day, user_agent FROM net_release_day ORDER BY day, user_agent`,
    );
    expect(second.rows).toEqual([
      { day: "2026-09-20", user_agent: "/Zebra:6.2.3/" },
      { day: "2026-09-21", user_agent: "/Zebra:6.3.0/" },
    ]);
  });
  it("records a day's hosting networks, stores none of the addresses, and replaces the day", async () => {
    const day = 1_790_000_000; // 2026-09-21 UTC
    await store.recordSeen(day, [node("1.1.1.1"), node("1.1.1.2"), node("8.8.4.4")]);
    const crawl = await store.beginCrawl(day);
    for (const host of ["1.1.1.1", "1.1.1.2", "8.8.4.4"]) {
      await store.recordProbe(crawl, node(host), day, { ok: true, pingMs: 5, version: version() });
    }
    await pool.query(
      `UPDATE net_node SET asn = 24940, asn_org = 'Hetzner Online GmbH' WHERE host LIKE '1.1.1.%'`,
    );
    await pool.query(`INSERT INTO net_asn_day VALUES ('2026-09-20', 16276, 'OVH SAS', 5)`);
    expect(await store.recordHostingDay(day)).toBe(2);
    const first = await pool.query(
      `SELECT to_char(day, 'YYYY-MM-DD') AS day, asn::int AS asn, asn_org, nodes
         FROM net_asn_day ORDER BY day, asn`,
    );
    // The un-enriched node has no network: 0 and '' rather than a guess.
    expect(first.rows).toEqual([
      { day: "2026-09-20", asn: 16276, asn_org: "OVH SAS", nodes: 5 },
      { day: "2026-09-21", asn: 0, asn_org: "", nodes: 1 },
      { day: "2026-09-21", asn: 24940, asn_org: "Hetzner Online GmbH", nodes: 2 },
    ]);
    const columns = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'net_asn_day'`,
    );
    expect(columns.rows.map((r) => r.column_name).sort()).toEqual([
      "asn",
      "asn_org",
      "day",
      "nodes",
    ]);
    await pool.query(`UPDATE net_node SET last_reachable = 1 WHERE host = '8.8.4.4'`);
    expect(await store.recordHostingDay(day + 600)).toBe(1);
  });
});
