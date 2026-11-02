# Run your own ShieldedScan

Every Zcash block, transaction and transparent input and output since 2016 is published as an
open dataset on Hugging Face (`Shieldedscanxyz/zcash-mainnet`). This folder imports one release of
it into PostgreSQL, so you get the explorer's database without indexing the chain from 2016. Use
the database directly, put the explorer's API in front of it, or both.

## Requirements

- Docker with Compose.
- **Disk: plan for 250 GB free, on an SSD.** About 150 GB stays in use once the import is done:
  the transparent ledger is about 130 GB with its indexes, transactions about 9 GB, blocks about
  2 GB, everything else under 2 GB. Building the indexes needs about 40 GB more for a while. The
  download is 20–27 GB; each file is deleted once its rows are in. These are estimates from row
  counts and the size per row measured on a synthetic import, not yet from a full one.
- **RAM: 8 GB at least, 16 GB recommended.**
- **Time:** a few hours on a machine with 8 cores and NVMe storage (an estimate, as above).
  Slower disks take longer, and so does a slow connection.

## Start

```sh
cd selfhost
cp env.example .env          # set POSTGRES_PASSWORD (and EXPLORER_API_TOKEN for the API)

docker compose --profile db up -d      # Postgres, filled from the latest release
docker compose logs -f importer        # progress; it exits 0 when the database checks out

docker compose --profile api up -d     # the same, plus the API on http://127.0.0.1:8080/v1
```

The importer downloads one release, checks every file against the release's `manifest.json`
(sha256), loads it, builds the indexes and the derived tables, and holds the result to the
release: row counts, the last block's hash, each block against its transactions, and the
transparent balances against the chain's transparent pool to the zatoshi. Stop it at any time;
running it again resumes where it stopped, and once it has passed it does nothing.

To import a specific release, set `SELFHOST_REVISION` to its dataset commit.

## Keep it current with a node

Set `NODE_RPC_URL` to a fully synced **Zebra** or **Zakura** mainnet node with JSON-RPC enabled
(`http://host.docker.internal:8232` for one on the same machine), then
`docker compose --profile api up -d` again. The follower continues from the release's last block,
and the API's trackers fill what only a node can give (below). Zebra keeps the whole chain, which
is what the trackers need for past blocks. Syncing a node from scratch takes a day or more; some
node projects publish snapshots of their state that shorten it.

## What is there without a node

Everything up to the release block: blocks, transactions, the transparent ledger, address
balances and the rich list, every daily and monthly series, fee and value records, miners per day,
and pool usage and boundary crossings up to three days before the release block. The `/v1` routes
that read the database work: lists, address history, the rich list, analytics. Block and
transaction detail, `/v1/status` and the supply figures ask the node, and answer 503 without one.

Empty until a node is configured: anything after the release block, pool usage and the other
trackers' newest days, transaction counts for addresses with a zero balance, and the reorg log
(observation starts when your follower does). `block.received_at` stays NULL: it is when our node
first saw a block, not chain data.

Empty unless you run their collectors: prices and FX rates, market caps, cross-chain swaps, the
network map and node crawl, social posts. `EXTERNAL_SOURCES=1` lets the API poll the public ones;
pages for a missing source say "unavailable", never a made-up figure.

## The tables

All amounts are zatoshis (`BIGINT`, 1 ZEC = 100,000,000), all times unix seconds, and NULL means
unknown, never zero. Shielded amounts are not in the data, because they are encrypted on chain:
only each pool's public net flow (`*_value_balance_zat`, positive = into the pool) is.

```
block (height) ──< tx (block_height) ──< tx_transparent_io (txid)
                                              │
chain_address_balance (address) <─────────────┘  sum of an address's outputs minus its inputs
```

| Table                                      | One row per                                                                                                                               |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `block`                                    | block: hash, time, size, tx counts by kind, fee total, Sapling/Orchard flows, the six value pools, difficulty, miner                      |
| `tx`                                       | transaction: `kind` (transparent, mixed, shielded, coinbase), `direction` for mixed, fee, each shielded bundle's counts and value balance |
| `tx_transparent_io`                        | transparent input (`io = 'in'`, with `prev_txid`/`prev_vout`) or output (`'out'`); `address` NULL when none or several                    |
| `chain_address_balance`                    | address with a positive balance: balance, received, first and last height, rank, transaction count                                        |
| `chain_rich_list_meta`                     | (one row) the height the balances stand at, and value held by no single address                                                           |
| `chain_sync_state`                         | (one row) the last block in the database                                                                                                  |
| `pool_usage_daily`, `boundary_daily`       | day (and pool): transactions using each shielded pool, its anonymity set; shielding and unshielding counts and records                    |
| `transparent_daily`, `transparent_monthly` | day / month: transparent volume and active addresses                                                                                      |
| `mining_day`, `mining_day_payout`          | day / day and payout address: blocks mined, reward and fees                                                                               |
| `chain_day_*`, `chain_month_*`             | materialized daily and monthly series (rollups, fees, pool flows, migrations, supply)                                                     |

The full definitions, with why each column is what it is, are in `server/schema-chain.sql` and
`server/schema.sql`. Indexes worth knowing: `tx (timestamp DESC, txid DESC)` for recent
transactions, `tx (block_height)`, and `tx_transparent_io (address, block_height DESC)` for an
address's history.

```sql
-- An address's latest transparent activity
SELECT txid, io, value_zat, block_height
  FROM tx_transparent_io
 WHERE address = 't1...'
 ORDER BY block_height DESC
 LIMIT 50;
```

## The web app

Not containerised yet: the `full` profile is still to come. Until then, run the Next.js app from
the repository root against your API (`CROSSCHAIN_API_URL` and `EXPLORER_API_TOKEN`; see
[docs/self-hosting.md](../docs/self-hosting.md)).
