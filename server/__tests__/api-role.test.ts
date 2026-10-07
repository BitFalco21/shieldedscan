import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { apiRoleFromEnv, claimPrimary } from "../api-role";

/**
 * The role a process plays, and the lock that keeps a database to one primary. The lock half needs
 * a real Postgres (it is the database that refuses), so it skips without TEST_DATABASE_URL:
 *
 *   TEST_DATABASE_URL=postgres://postgres:test@localhost:55432/explorer \
 *     npx vitest run server/__tests__/api-role.test.ts
 */

describe("apiRoleFromEnv", () => {
  it("is primary when unset, so a single-container deployment is unchanged", () => {
    expect(apiRoleFromEnv({})).toEqual({ role: "primary" });
    expect(apiRoleFromEnv({ API_ROLE: "" })).toEqual({ role: "primary" });
    expect(apiRoleFromEnv({ API_ROLE: "primary" })).toEqual({ role: "primary" });
  });

  it("names the primary a replica reads from, trimmed of a trailing slash", () => {
    expect(
      apiRoleFromEnv({ API_ROLE: "replica", PRIMARY_API_URL: "http://explorer-api:8080/" }),
    ).toEqual({ role: "replica", primaryUrl: "http://explorer-api:8080" });
  });

  it("refuses a typo rather than guessing primary, and a replica with no primary", () => {
    // A guessed primary is a second set of pollers on one database.
    expect(() => apiRoleFromEnv({ API_ROLE: "replicas" })).toThrow(/must be "primary" or/);
    expect(() => apiRoleFromEnv({ API_ROLE: "replica" })).toThrow(/PRIMARY_API_URL/);
    expect(() => apiRoleFromEnv({ API_ROLE: "replica", PRIMARY_API_URL: "explorer-api" })).toThrow(
      /PRIMARY_API_URL/,
    );
  });
});

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb("claimPrimary", () => {
  const pools: Pool[] = [];
  const pool = () => {
    const p = new Pool({ connectionString: DATABASE_URL, max: 1 });
    pools.push(p);
    return p;
  };
  afterAll(async () => {
    await Promise.all(pools.map((p) => p.end().catch(() => undefined)));
  });

  it("refuses a second primary on one database, and admits one once the first has gone", async () => {
    const first = await claimPrimary(pool(), () => undefined);
    await expect(claimPrimary(pool(), () => undefined, 2, 10)).rejects.toThrow(
      /another primary API holds this database's primary lock/,
    );
    // The first process exits: its connection closes and the lock goes with it.
    first.release(true);
    const second = await claimPrimary(pool(), () => undefined, 20, 50);
    second.release(true);
  });
});
