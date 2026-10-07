import { Pool, type PoolClient, type PoolConfig } from "pg";

/**
 * Construct a `pg` pool from an optional connection string plus options.
 *
 * Passing `connectionString: undefined` explicitly does not fall back to the `PG*` environment
 * variables, so the key is omitted when no connection string is given. One helper keeps every
 * caller from re-spelling that conditional (and from dropping the options spread with it).
 */
export function createPool(connection: string | undefined, opts: PoolConfig = {}): Pool {
  return new Pool(connection ? { connectionString: connection, ...opts } : { ...opts });
}

/**
 * Roll back a transaction that failed, from its `catch`. A ROLLBACK that itself fails (the
 * connection is already gone) is ignored, so the error that caused it is the one that propagates.
 */
export async function rollbackQuietly(client: Pick<PoolClient, "query">): Promise<void> {
  await client.query("ROLLBACK").catch(() => undefined);
}
