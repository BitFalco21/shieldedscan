import { ChainIndexStore } from "../chain-index-store";
import { MemoryStorePort, type CrossChainStorePort } from "../crosschain-store";
import { createPool } from "../pg-pool";
import { PostgresStorePort } from "../postgres-crosschain-store";
import { DATABASE_URL, IS_PRIMARY, SCHEMA_PATH, USE_POSTGRES } from "./config";
import { startPriceAndFxHistory } from "./jobs";

/** The API's two stores: the cross-chain transfers and the chain index. */

/**
 * The cross-chain store. On a primary it also applies `schema.sql` and starts the price and rate
 * history jobs that fill tables of the same schema.
 */
export async function createCrossChainStore(
  log: (message: string) => void,
): Promise<CrossChainStorePort> {
  if (!USE_POSTGRES) {
    // Supported: local development needs no database, and losing the store on restart is honest
    // rather than a silent half-persistence.
    log(
      "no Postgres configured (DATABASE_URL or PGHOST) — in-memory store, history will not persist",
    );
    return new MemoryStorePort();
  }
  const store = new PostgresStorePort(DATABASE_URL);
  if (!IS_PRIMARY) {
    // The schema and the price and rate history belong to the primary: a replica applies no DDL
    // (two processes creating one table at once can collide) and fills no table.
    log("postgres store ready (replica — schema and history are the primary's)");
    return store;
  }
  await store.migrate(SCHEMA_PATH);
  log("postgres store ready, schema applied");
  startPriceAndFxHistory(DATABASE_URL, log);
  return store;
}

/**
 * The chain index, twice over: the site's own store and the public surface's, the same queries on
 * separate pools so a public flood (of the widest transactions, or deep address pages) cannot hold
 * the connections the site's own reads need. They need only Postgres, so `/v1`'s transaction list
 * works even when the node is unreachable.
 */
export function createChainIndexStores(): {
  chainIndex: ChainIndexStore | undefined;
  publicChainIndex: ChainIndexStore | undefined;
} {
  if (!USE_POSTGRES) return { chainIndex: undefined, publicChainIndex: undefined };
  return {
    // A 30 s statement_timeout: an unbounded query on a small pool reads as an outage. Generous,
    // because a wide transaction's input list is legitimately slow on a cold cache.
    chainIndex: new ChainIndexStore(
      createPool(DATABASE_URL, { max: 4, statement_timeout: 30_000 }),
    ),
    // A caller that cannot get a connection within ten seconds is answered 503.
    publicChainIndex: new ChainIndexStore(
      createPool(DATABASE_URL, {
        max: 4,
        statement_timeout: 30_000,
        connectionTimeoutMillis: 10_000,
      }),
    ),
  };
}
