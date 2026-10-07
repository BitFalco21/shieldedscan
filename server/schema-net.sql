-- The network crawler's tables: nodes seen on Zcash's P2P network, per-cycle probe outcomes,
-- the gossip graph, and the local GeoIP/ASN range tables that enrich them.
--
-- Conventions follow schema.sql / schema-chain.sql: timestamps are BIGINT unix seconds,
-- everything idempotent and safe to re-run on boot. Applied by the crawler container only
-- (crawler-main.ts), the one writer of these tables; the API reads them and answers 503 while
-- they do not exist yet.
--
-- Node addresses are public P2P data (any peer observes them), not visitor data. Full addresses
-- stay in Postgres (re-crawling and uptime need them) and only derived facts are ever published:
-- country, city, ASN, /24 cluster counts, hashed topology ids. No route may return a full
-- address; the route tests assert it.

CREATE TABLE IF NOT EXISTS net_node (
  host             TEXT    NOT NULL,   -- dotted quad, canonical ipv6, or x…x.onion
  port             INTEGER NOT NULL,
  network          TEXT    NOT NULL CHECK (network IN ('ipv4', 'ipv6', 'torv3')),

  first_seen       BIGINT  NOT NULL,   -- first advertised or probed
  last_seen        BIGINT  NOT NULL,   -- newest advertisement or contact
  last_attempt     BIGINT,             -- NULL = never dialled (torv3 always: no Tor client)
  last_reachable   BIGINT,             -- NULL = never completed a handshake

    -- Self-reported by the peer's own version message: claims, not facts. The user agent is
    -- sanitised at the codec's parse boundary before it reaches this column.
  user_agent       TEXT,
  protocol_version INTEGER,
  services         BIGINT,
  best_height      INTEGER,
    -- TCP connect to verack, measured from our own host: a fact about our vantage point.
  ping_ms          INTEGER,

    -- Enrichment from the local GeoLite2 range tables below. NULL until enriched and NULL when
    -- the lookup finds nothing, never a fabricated location.
  country          TEXT,
  city             TEXT,
  lat              DOUBLE PRECISION,
  lon              DOUBLE PRECISION,
  asn              BIGINT,
  asn_org          TEXT,
  geo_checked_at   BIGINT,
  -- On the Tor Project's published exit list (clearnet Tor). torv3 rows are Tor by
  -- construction and do not need this flag.
  tor_exit         BOOLEAN NOT NULL DEFAULT false,

  PRIMARY KEY (host, port)
);

CREATE INDEX IF NOT EXISTS net_node_reachable_idx ON net_node (last_reachable DESC NULLS LAST);

-- Why the last probe failed (socket error text, "timed out", "handshake incomplete"), NULL after
-- a success. Diagnostic, never published: it distinguishes a dead backend behind a NAT
-- (accept-then-close) from a firewalled host (timeout) from nothing listening (refused).
ALTER TABLE net_node ADD COLUMN IF NOT EXISTS last_error TEXT;

-- The gossip graph: who advertised whom. This is the topology view, and the UI says so:
-- addresses a peer advertised, never live connections, which are not observable from outside.
-- Pruned past NET_LINK_KEEP_SECONDS so it cannot grow forever.
CREATE TABLE IF NOT EXISTS net_link (
  from_host       TEXT    NOT NULL,
  from_port       INTEGER NOT NULL,
  to_host         TEXT    NOT NULL,
  to_port         INTEGER NOT NULL,
  last_advertised BIGINT  NOT NULL,
  PRIMARY KEY (from_host, from_port, to_host, to_port)
);

-- One row per crawl cycle: the denominators every published aggregate needs.
CREATE TABLE IF NOT EXISTS net_crawl (
  id          BIGSERIAL PRIMARY KEY,
  started_at  BIGINT  NOT NULL,
  finished_at BIGINT,                  -- NULL = still running or died mid-cycle
  attempted   INTEGER NOT NULL DEFAULT 0,
  reachable   INTEGER NOT NULL DEFAULT 0,
  new_nodes   INTEGER NOT NULL DEFAULT 0
);

-- Per-node, per-cycle outcomes. Uptime over a window is reached/attempted from this table, and
-- rows past the keep window are pruned by the crawler itself.
CREATE TABLE IF NOT EXISTS net_probe (
  crawl_id BIGINT  NOT NULL,
  host     TEXT    NOT NULL,
  port     INTEGER NOT NULL,
  at       BIGINT  NOT NULL,
  ok       BOOLEAN NOT NULL,
  ping_ms  INTEGER,
  PRIMARY KEY (crawl_id, host, port)
);

CREATE INDEX IF NOT EXISTS net_probe_at_idx ON net_probe (at);
-- The node map reads reached/attempted per node (one lateral per live node); without this index
-- each lateral is a sequential scan of every probe kept.
CREATE INDEX IF NOT EXISTS net_probe_node_idx ON net_probe (host, port);
-- The same lateral reads `ok` for every probe; with `ok` included, each count is an index-only
-- scan instead of a heap fetch per row (seconds cold, under disk load, against milliseconds).
CREATE INDEX IF NOT EXISTS net_probe_node_ok_idx ON net_probe (host, port) INCLUDE (ok);

-- GeoLite2 range tables, loaded from MaxMind's CSV form by scripts/refresh-geoip.sh into
-- _staging twins and swapped in one transaction, so stale rows never linger. Postgres inet
-- containment (`network >>= ip`) with a GiST index is the whole lookup: no .mmdb reader, no new
-- dependency, and no node IP ever leaves the host.
CREATE TABLE IF NOT EXISTS net_geo_block (
  network    CIDR NOT NULL,
  geoname_id BIGINT,
  lat        DOUBLE PRECISION,
  lon        DOUBLE PRECISION
);

CREATE INDEX IF NOT EXISTS net_geo_block_gist ON net_geo_block USING gist (network inet_ops);

CREATE TABLE IF NOT EXISTS net_geo_location (
  geoname_id BIGINT PRIMARY KEY,
  country    TEXT,
  city       TEXT
);

CREATE TABLE IF NOT EXISTS net_asn_block (
  network CIDR NOT NULL,
  asn     BIGINT,
  asn_org TEXT
);

CREATE INDEX IF NOT EXISTS net_asn_block_gist ON net_asn_block USING gist (network inet_ops);

-- The Tor Project's published exit list (keyless), replaced whole on each fetch.
CREATE TABLE IF NOT EXISTS net_tor_exit (
  ip         TEXT   PRIMARY KEY,
  fetched_at BIGINT NOT NULL
);

-- One row per (UTC day, user agent, declared protocol version): how many nodes answered in the
-- 24 hours before the day's last crawl, and how many were behind our tip at their last answer.
-- Written by the crawler after every cycle, the day's rows replaced whole, so the day's final
-- write is its record (`NetStore.recordReleaseDay`).
--
-- `net_node` holds only each node's current state, so how the network moved through an upgrade
-- cannot be rebuilt afterwards and is kept as it happens. The user agent is stored raw and
-- classified at read time by the same function the other views use. '' and -1 stand for "none
-- declared", because a primary key cannot hold a NULL.
CREATE TABLE IF NOT EXISTS net_release_day (
  day              DATE    NOT NULL,
  user_agent       TEXT    NOT NULL,
  protocol_version INTEGER NOT NULL,
  nodes            INTEGER NOT NULL,
  behind_tip       INTEGER NOT NULL,
  tip_unknown      INTEGER NOT NULL,
  PRIMARY KEY (day, user_agent, protocol_version)
);
