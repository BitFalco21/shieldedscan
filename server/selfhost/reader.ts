import type { Pool } from "pg";

/**
 * A login for your own apps on a self-hosted database: SELECT on the tables, views and
 * materialized views of the `public` schema, and nothing else.
 *
 * The grants are the limit. `default_transaction_read_only` only makes a stray write fail early (a
 * session can switch it off, and still has no right to write). The timeouts and the connection
 * limit keep one client from holding back the follower: a long SELECT on a materialized view
 * blocks its refresh. TEMP is revoked from PUBLIC because a revoke from the role alone does nothing
 * against PUBLIC's grant; the owner keeps its own.
 *
 * The password is passed as a bind parameter and read back inside the statement, so it never
 * appears in a statement's text, which Postgres logs when a statement fails.
 */

export const READER_ROLE = "shieldedscan_reader";

/** Role names are interpolated as identifiers: plain lowercase words only. */
const ROLE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

export type ReaderState = "enabled" | "disabled" | "absent";

export async function ensureReader(
  pool: Pool,
  opts: { password: string | undefined; role?: string },
): Promise<ReaderState> {
  const role = opts.role ?? READER_ROLE;
  if (!ROLE_NAME.test(role)) throw new Error(`not a role name: ${JSON.stringify(role)}`);
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ db: string; exists: boolean }>(
      "SELECT current_database() AS db, EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS exists",
      [role],
    );
    const { db, exists } = rows[0]!;
    if (!opts.password) {
      if (!exists) return "absent";
      await client.query(`ALTER ROLE ${role} NOLOGIN`);
      return "disabled";
    }
    const database = `"${db.replace(/"/g, '""')}"`;
    await client.query("BEGIN");
    await client.query("SELECT set_config('selfhost.reader_password', $1, true)", [opts.password]);
    if (!exists) await client.query(`CREATE ROLE ${role}`);
    await client.query(
      `DO $$ BEGIN
         EXECUTE format('ALTER ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION
                         NOBYPASSRLS CONNECTION LIMIT 8 PASSWORD %L',
                        current_setting('selfhost.reader_password'));
       END $$`,
    );
    for (const sql of [
      `ALTER ROLE ${role} SET default_transaction_read_only = on`,
      `ALTER ROLE ${role} SET statement_timeout = '5min'`,
      `ALTER ROLE ${role} SET idle_in_transaction_session_timeout = '1min'`,
      `REVOKE TEMP ON DATABASE ${database} FROM PUBLIC`,
      `GRANT CONNECT ON DATABASE ${database} TO ${role}`,
      `GRANT USAGE ON SCHEMA public TO ${role}`,
      `GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${role}`,
      // Tables and views the services create later, as this same owner (the API and follower apply
      // their schema files on start).
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ${role}`,
    ]) {
      await client.query(sql);
    }
    await client.query("COMMIT");
    return "enabled";
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}
