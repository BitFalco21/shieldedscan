# Run your own ShieldedScan

Every Zcash block, transaction and transparent input and output since 2016 is published as an
open dataset on Hugging Face (`Shieldedscanxyz/zcash-mainnet`). This folder imports one release of
it into PostgreSQL, so you get the explorer's database without indexing the chain from 2016, and
can put the API and the website in front of it.

| Profile | What runs                                    | Where                              |
| ------- | -------------------------------------------- | ---------------------------------- |
| `db`    | Postgres, filled from the latest release     | `127.0.0.1:5432`                   |
| `api`   | the same, plus the keyless `/v1` API and MCP | `http://127.0.0.1:8080/v1`, `/mcp` |
| `full`  | the same, plus the website                   | `http://localhost:3000`            |

Everything listens on 127.0.0.1 only.

## Start

```sh
cd selfhost
cp env.example .env              # set POSTGRES_PASSWORD and EXPLORER_API_TOKEN
docker compose --profile full up -d    # or: --profile db, --profile api
docker compose logs -f importer        # progress; it exits 0 when the database checks out
```

The importer downloads one release, checks every file against the release's `manifest.json`
(sha256), loads it, builds the indexes and derived tables, and holds the result to the release:
row counts, the last block's hash, each block against its transactions, and the transparent
balances against the chain's transparent pool to the zatoshi. Stop it at any time; running it
again resumes, and once it has passed it does nothing. `SELFHOST_REVISION` pins a release (a
dataset commit). The API and the website start once the import has passed.

## Use the data with your own frontend

**The API.** `GET http://127.0.0.1:8080/v1` lists every route. No key, and any origin may read it
(`Access-Control-Allow-Origin: *`), so a page served from anywhere can call it:

```js
const API = "http://127.0.0.1:8080/v1";

async function latestBlocks(limit = 10) {
  const res = await fetch(`${API}/blocks?limit=${limit}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`); // 503: needs a node, see below
  const { items } = await res.json();
  return items.map((b) => ({ height: b.height, hash: b.hash, txs: b.txCount }));
}

latestBlocks().then(console.table);
```

Amounts are integer zatoshis (`*Zat`, 1 ZEC = 100,000,000). A key that can be unknown is always
present, null, with the reason in `unknowns`. The reference is the site's `/api-docs` page.

**MCP.** `http://127.0.0.1:8080/mcp` is a stateless MCP server (Streamable HTTP, no login) whose
tools are the `/v1` routes. For a client that takes a JSON config:

```json
{ "mcpServers": { "shieldedscan": { "url": "http://127.0.0.1:8080/mcp" } } }
```

**SQL.** Set `POSTGRES_READONLY_PASSWORD` in `.env` and start again: the importer then creates
`shieldedscan_reader`, which can read every table and view and change nothing. Unset it and start
again to lock that login.

```sh
psql "postgresql://shieldedscan_reader@127.0.0.1:5432/shieldedscan"
```

The tables are described below. To publish the API beyond this machine, put a reverse proxy in
front of it: the per-address rate limits live in `server/Caddyfile`, not in the API.

## Requirements

- Docker with Compose.
- **Disk: plan for 250 GB free, on an SSD.** The database is about 155 GB once the import is
  done; the import peaks about 45 GB higher while it builds indexes. The download is about 13.4 GB
  and each file is deleted once its rows are in. The space is needed where Docker keeps its
  volumes (`docker info --format '{{.DockerRootDir}}'`).
- **RAM: 8 GB at least, 16 GB recommended.**
- **Time:** under 3 hours.

Measured on a full import of the release at block 3,550,353 (16 threads, 16 GB RAM, an SSD under
WSL 2): 2 h 47 min from start to the database checking out, a peak of about 200 GB of disk, and
about 157 GB in use after it (the database and the images). Slower disks or a slow connection
take longer.

## Keep it current with a node

Set `NODE_RPC_URL` to a fully synced **Zebra** or **Zakura** mainnet node with JSON-RPC enabled
(`http://host.docker.internal:8232` for one on the same machine) and start again. The follower
continues from the release's last block, and the API reads the node for what only a node has.
Syncing a node from scratch takes a day or more.

## Without a node

The API and the website state the chain as of the release block: blocks, transactions and
transparent addresses (balance and history), search by height, block hash or txid, the rich list,
analytics and charts. A block's header fields (version, bits, nonce, Merkle and commitment roots)
are not in the data, so the block page shows them as unavailable. What only a node can answer is
"unavailable" (HTTP 503), never a guess:

- anything the release does not hold: a block or transaction after it, or an address with no
  transparent activity up to it;
- an emptied address with more than 20,000 transparent inputs and outputs;
- `/v1/mempool/summary` and `/v1/network/halving`;
- on the website: the mempool, pulse, the halving, mining cost, stats, the network map, and on
  `/miners` the tip's mining terms and the NSM balance.

The day-by-day tables stop at the release's final day, three days before the release block's day.
`block.received_at` stays NULL: it is when our node first saw a block, not chain data.

## Prices and other off-chain data

Prices are not chain data, so the dataset does not carry them (the price sources' terms do not allow
republishing). Your API fetches them itself: on first start it loads the daily ZEC/USD close back
to 2016 and the currency rates, in a few minutes, with no key and no node, and refreshes them daily.
Every USD figure and price chart fills in from them. A total that includes the current day is
priced at the live price, which needs a node, so without one it reads unavailable rather than
estimated. It also polls market caps, swap venues, the ZIP
index and names. The live price on the home page needs a node as well. `EXTERNAL_SOURCES=0` turns
all of this off: after the import the box calls no third party, and USD figures stay empty.

Empty unless you run their collectors: cross-chain swap history, the network map, social posts.
The assistant is off: it needs a model host's key.

## The tables

All amounts are zatoshis (`BIGINT`), all times unix seconds, and NULL means unknown, never zero.
Shielded amounts are not in the data, because they are encrypted on chain: only each pool's
public net flow (`*_value_balance_zat`, positive = into the pool) is.

| Table                                      | One row per                                                                                  |
| ------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `block`                                    | block: hash, time, size, tx counts by kind, fees, pool flows and balances, difficulty, miner |
| `tx`                                       | transaction: kind, direction, fee, each shielded bundle's counts and value balance           |
| `tx_transparent_io`                        | transparent input (`io = 'in'`) or output (`'out'`); `address` NULL when none or several     |
| `chain_address_balance`                    | address with a positive balance: balance, received, first and last height, tx count          |
| `chain_rich_list_meta`, `chain_sync_state` | (one row each) the height the balances stand at; the last block in the database              |
| `pool_usage_daily`, `boundary_daily`       | day (and pool): pool usage and anonymity set; shielding and unshielding                      |
| `transparent_daily`, `transparent_monthly` | day / month: transparent volume and active addresses                                         |
| `mining_day`, `mining_day_payout`          | day / day and payout address: blocks mined, reward and fees                                  |
| `chain_day_*`, `chain_month_*`             | materialized daily and monthly series                                                        |

Why each column is what it is: `server/schema-chain.sql` and `server/schema.sql`.

```sql
-- An address's latest transparent activity (uses tx_transparent_io (address, block_height DESC))
SELECT txid, io, value_zat, block_height
  FROM tx_transparent_io
 WHERE address = 't1...'
 ORDER BY block_height DESC
 LIMIT 50;
```
