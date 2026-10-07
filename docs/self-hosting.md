# Self-hosting

How to run the whole stack: a Zcash node, Postgres, the services in `server/`, and the Next.js
frontend. The frontend alone needs none of this; `npm run dev` serves fixtures.

Every variable mentioned here is listed, with its default, in [`.env.example`](../.env.example).

## What runs

```
Browser ──► Next.js frontend ──► reverse proxy ──► API service ──► Postgres
                                                        │            ▲
                                                        └──► node ◄──┤
                                       follower / backfill ──────────┤
                                       network crawler ──────────────┘
```

| Service  | Entry point               | Image (`server/`)     | Needs                       |
| -------- | ------------------------- | --------------------- | --------------------------- |
| API      | `server/index.ts`         | `Dockerfile`          | Postgres, node RPC, a token |
| Follower | `server/follow-main.ts`   | `Dockerfile.follower` | Postgres, node RPC          |
| Backfill | `server/backfill-main.ts` | `Dockerfile.follower` | Postgres, node RPC          |
| Crawler  | `server/crawler-main.ts`  | `Dockerfile.crawler`  | Postgres, outbound P2P      |
| Proxy    | `server/Caddyfile`        | `Dockerfile.caddy`    | the API                     |
| Frontend | `src/` (Next.js)          | none                  | the API's URL and token     |

The follower image also carries the one-shot maintenance jobs (`bootstrap-rich-list.mjs` and the
`repair-*.mjs` jobs); each one's header in `server/` says what it does and which variables it
reads.

Build the images from the repository root, for example
`docker build -f server/Dockerfile.follower -t explorer-follower .`. Without Docker,
`npm run build:server` bundles the API to `dist/server.mjs`, and `scripts/bundle.mjs` bundles any
other entry point the same way.

## Requirements

- **A Zcash node with JSON-RPC enabled.** The code is developed against Zebra-family nodes
  (Zakura, a Zebra fork, in archive mode). The follower reads full blocks (`getblock` at
  verbosity 2) and resolves transaction inputs (`getrawtransaction`), so the node must keep the
  whole chain; the API also calls `getblockchaininfo`, `getblocksubsidy`, `getnetworksolps`,
  `getrawmempool` and `getpeerinfo`. zcashd is end-of-life and is not supported. The node must be
  fully synced before ingestion is useful.
- **PostgreSQL** (developed against version 17). One database holds everything.
- **Node.js 22** to build, or Docker.
- **Disk.** A full mainnet transaction index runs to well over 100 GB in Postgres, on top of the
  node's own archive.

## Postgres schemas

Each service applies its own schema file at start, idempotently, so there is no separate
migration step:

| File                      | Applied by         | Holds                                            |
| ------------------------- | ------------------ | ------------------------------------------------ |
| `server/schema-chain.sql` | follower, backfill | blocks, transactions, transparent I/O, rollups   |
| `server/schema.sql`       | API                | cross-chain transfers, prices, derived analytics |
| `server/schema-net.sql`   | crawler            | the network map                                  |

Several materialised views are created empty (`WITH NO DATA`) and filled by the steps below,
because a first fill scans the whole chain and must not run inside a service's startup.

## Startup order

1. **Start the node** and let it sync.
2. **Start Postgres** and create a database and a role for the services.
3. **Start the follower** with `DATABASE_URL` (or the `PG*` variables) and `NODE_RPC_URL`. It
   applies the chain schema and follows the tip. In the default `rollup` mode it stores one row
   per block, which is enough for block lists and the supply series.
4. **Backfill transactions** (optional, for address history, fees and transaction lists): run
   `node backfill.mjs` from the follower image to completion, recreate the follower with
   `CHAIN_INGEST_MODE=full`, then run the backfill once more to fill the blocks ingested between
   the two. The header of `server/backfill-main.ts` describes the sequence.
5. **Fill the derived tables once:** `node bootstrap-rich-list.mjs` from the follower image, then
   `npm run fill:pool-analytics`. The follower keeps both current afterwards.
6. **Start the API** with `EXPLORER_API_TOKEN` (32 or more random characters), the database and
   `NODE_RPC_URL`. Set `PUBLIC_API_ENABLED=1` for the keyless `/v1` API and MCP server, and
   `AGENT_ENABLED=1` plus a model-host key for the assistant. `GET /health` reports readiness.
7. **Start the crawler** (optional, for `/network`) with the database. Run
   `scripts/refresh-geoip.sh` with a MaxMind licence key to load the location tables; it is
   safe to re-run, for example monthly.
8. **Put a reverse proxy in front of the API.** `server/Caddyfile` is a working configuration
   for the custom Caddy image in `server/Dockerfile.caddy` (TLS plus per-path rate limits);
   replace its site addresses with your own. Publish only the proxy: Postgres and the node's RPC
   port should never be reachable from outside.
9. **Point the frontend at the API:** set `CROSSCHAIN_API_URL` and `EXPLORER_API_TOKEN`, then
   `npm run build && npm start`, or deploy to any host that runs Next.js. Set
   `NEXT_PUBLIC_SITE_URL` to your public origin and `NEXT_PUBLIC_STAGE=public` when it should be
   indexed; a public build refuses to build on fixtures.

## Configuration per service

| Service  | Required                   | Common options                                                                                                             |
| -------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| API      | `EXPLORER_API_TOKEN`       | `DATABASE_URL`, `NODE_RPC_URL`, `ZCASH_NETWORK`, `PUBLIC_API_ENABLED`, `AGENT_ENABLED`, `NEAR_INTENTS_API_KEY`, `API_ROLE` |
| Follower | `DATABASE_URL` or `PGHOST` | `NODE_RPC_URL`, `CHAIN_INGEST_MODE`, `FOLLOW_BATCH`                                                                        |
| Backfill | `DATABASE_URL` or `PGHOST` | `NODE_RPC_URL`, `BACKFILL_START`, `BACKFILL_END`                                                                           |
| Crawler  | `DATABASE_URL` or `PGHOST` | `ZCASH_NETWORK`, `ZCASH_P2P_PORT`, `CRAWL_CONCURRENCY`, `CRAWL_INTERVAL_MS`                                                |
| Frontend | none (fixtures)            | `CROSSCHAIN_API_URL`, `EXPLORER_API_TOKEN`, `NEXT_PUBLIC_*`                                                                |

Without a database the API keeps cross-chain transfers in memory and serves no index-backed
route; without `NODE_RPC_URL` it mounts no node-backed route. Pages that need a missing route
render "unavailable" rather than failing.

A second API container can share the database as a replica: set `API_ROLE=replica` and
`PRIMARY_API_URL` to the primary. Only the primary runs the background pollers; a replica reads
their live state from it.

## Testnet

Testnet is a separate deployment, never a parameter of one: its own node, database, services and
frontend. Set `ZCASH_NETWORK=testnet` on the API and crawler (and `ZCASH_P2P_PORT` to the testnet
port), and `NEXT_PUBLIC_NETWORK=testnet` on the frontend. Pages that only make sense on mainnet,
such as cross-chain and prices, are absent there.

## The test database

`npm test` runs without a database; the database suites skip themselves. To run them, point
`TEST_DATABASE_URL` at a scratch PostgreSQL server with a role that has `CREATEDB` and can connect
to the `postgres` database: several suites create and drop their own databases. Never point it at
a database you care about.

Run them one file at a time, since several suites share tables:

```sh
TEST_DATABASE_URL=postgres://postgres:secret@localhost:5432/explorer_test \
  npx vitest run --no-file-parallelism server
```

`TEST_DATABASE_HAS_REAL_DATA=1` additionally runs the suites that compare views over a database
holding real chain data, and `TEST_NODE_RPC_URL` enables the live follower test, which ingests
from genesis against a real node.
