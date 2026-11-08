// @vitest-environment node
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureReader } from "../reader";

/**
 * The read-only login for a user's own apps: it reads every table, view and materialized view in
 * `public`, including ones created after it, and can change nothing. Skips without
 * TEST_DATABASE_URL, like the other DB suites.
 */
const ADMIN_URL = process.env.TEST_DATABASE_URL;
const DB = `selfhost_reader_${process.pid}`;
const ROLE = `selfhost_reader_test_${process.pid}`;

describe("ensureReader", () => {
  it("refuses a role name it would have to quote", async () => {
    await expect(ensureReader({} as Pool, { password: "x", role: 'a"; DROP' })).rejects.toThrow(
      /not a role name/,
    );
  });
});

describe.skipIf(!ADMIN_URL)("the self-host read-only role", () => {
  let admin: Client;
  let owner: Pool;
  let url: URL;

  /** Runs each statement in turn in one session, and answers the last. */
  const asReader = async (password: string, ...sql: string[]) => {
    const reader = new URL(url);
    reader.username = ROLE;
    reader.password = password;
    const client = new Client({ connectionString: reader.toString() });
    await client.connect();
    try {
      let last = await client.query(sql[0]!);
      for (const s of sql.slice(1)) last = await client.query(s);
      return last;
    } finally {
      await client.end();
    }
  };

  beforeAll(async () => {
    admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
    await admin.query(`DROP ROLE IF EXISTS ${ROLE}`);
    await admin.query(`CREATE DATABASE ${DB}`);
    url = new URL(ADMIN_URL!);
    url.pathname = `/${DB}`;
    owner = new Pool({ connectionString: url.toString(), max: 2 });
    await owner.query("CREATE TABLE block (height INTEGER PRIMARY KEY, hash TEXT NOT NULL)");
    await owner.query("INSERT INTO block VALUES (1, 'ab'), (2, 'cd')");
    await owner.query(
      "CREATE MATERIALIZED VIEW block_count AS SELECT count(*)::int AS n FROM block",
    );
  });

  afterAll(async () => {
    await owner?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
    await admin?.query(`DROP ROLE IF EXISTS ${ROLE}`);
    await admin?.end();
  });

  it("reads tables and materialized views, and writes nothing", async () => {
    expect(await ensureReader(owner, { password: "first-pw", role: ROLE })).toBe("enabled");
    expect((await asReader("first-pw", "SELECT count(*)::int AS n FROM block")).rows).toEqual([
      { n: 2 },
    ]);
    expect((await asReader("first-pw", "SELECT n FROM block_count")).rows).toEqual([{ n: 2 }]);

    for (const sql of [
      "INSERT INTO block VALUES (3, 'ef')",
      "UPDATE block SET hash = 'zz'",
      "DELETE FROM block",
      "TRUNCATE block",
      "CREATE TABLE mine (x int)",
      "CREATE TEMP TABLE scratch (x int)",
      "REFRESH MATERIALIZED VIEW block_count",
      "ALTER TABLE block ADD COLUMN x int",
      "DROP TABLE block",
    ]) {
      // Each in a session that first turns the read-only default off: the grants alone must refuse.
      await expect(
        asReader("first-pw", "SET default_transaction_read_only = off", sql),
        sql,
      ).rejects.toThrow(/permission denied|must be owner/);
    }
    expect((await owner.query("SELECT count(*)::int AS n FROM block")).rows).toEqual([{ n: 2 }]);
  });

  it("reads a table and a materialized view the owner creates afterwards", async () => {
    await owner.query("CREATE TABLE later (x int)");
    await owner.query("INSERT INTO later VALUES (7)");
    await owner.query("CREATE MATERIALIZED VIEW later_view AS SELECT x FROM later");
    expect((await asReader("first-pw", "SELECT x FROM later")).rows).toEqual([{ x: 7 }]);
    expect((await asReader("first-pw", "SELECT x FROM later_view")).rows).toEqual([{ x: 7 }]);
  });

  it("takes a new password on the next run, and is locked out once it is unset", async () => {
    expect(await ensureReader(owner, { password: 'it\'s-a "new" pw', role: ROLE })).toBe("enabled");
    await expect(asReader("first-pw", "SELECT 1")).rejects.toThrow(/password/);
    expect((await asReader('it\'s-a "new" pw', "SELECT 1 AS one")).rows).toEqual([{ one: 1 }]);

    expect(await ensureReader(owner, { password: undefined, role: ROLE })).toBe("disabled");
    await expect(asReader('it\'s-a "new" pw', "SELECT 1")).rejects.toThrow(
      /not permitted to log in/,
    );
  });

  it("creates nothing when no password was ever set", async () => {
    expect(await ensureReader(owner, { password: "", role: `${ROLE}_none` })).toBe("absent");
    const { rows } = await owner.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [
      `${ROLE}_none`,
    ]);
    expect(rows).toEqual([]);
  });
});
