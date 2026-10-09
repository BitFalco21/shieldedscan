import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import type { Hono } from "hono";
import { ADDRESS_LABELS, type LabelledBalances } from "@/domain";
import { loadLabelledBalances, networkRoutes } from "../network-routes";
import { MemoryStorePort } from "../crosschain-store";
import { v1Routes } from "../v1/routes";
import type { V1Labels } from "../v1/dto";

/**
 * The labelled-address balances behind the agent's label guide, against a real database.
 *
 * The three states are the point: a balance row (a balance and a rank), a row the hourly pass has
 * not ranked yet (rank 0 in the column, which must read as no rank rather than first place), and no
 * row at all (the index keeps rows only while positive, so that is a measured zero, not a gap).
 *
 * Skips without TEST_DATABASE_URL:
 *
 *   docker run -d --name pg-test -e POSTGRES_PASSWORD=test -e POSTGRES_USER=test \
 *     -e POSTGRES_DB=test -p 55433:5432 postgres:17
 *   TEST_DATABASE_URL=postgres://test:test@127.0.0.1:55433/test \
 *     npx vitest run server/__tests__/labelled-balances.test.ts
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

async function createTestDatabase(url: string): Promise<string> {
  const name = "explorer_labelled_balances_test";
  const admin = new Pool({ connectionString: withDatabase(url, "postgres"), max: 1 });
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${name}`);
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
  return withDatabase(url, name);
}

describeDb("labelled-address balances", () => {
  let app: Hono;
  let v1: Hono;
  let pool: Pool;
  const [ranked, unranked, absent] = Object.keys(ADDRESS_LABELS) as [string, string, string];
  /** Unlike any plausible tip, so a route that substituted the chain height would fail. */
  const RANK_HEIGHT = 3_400_001;

  beforeAll(async () => {
    const url = await createTestDatabase(DATABASE_URL!);
    pool = new Pool({ connectionString: url, max: 2 });
    await pool.query(`CREATE TABLE chain_address_balance (
        address      TEXT PRIMARY KEY,
        balance_zat  BIGINT NOT NULL,
        received_zat BIGINT NOT NULL,
        first_height INTEGER NOT NULL,
        last_height  INTEGER NOT NULL,
        rank         BIGINT NOT NULL DEFAULT 0,
        tx_count     BIGINT)`);
    await pool.query(
      `INSERT INTO chain_address_balance
         (address, balance_zat, received_zat, first_height, last_height, rank)
       VALUES ($1, 43892090013445, 43892090013445, 1, 1, 1),
              ($2, 2869648329284, 2869648329284, 1, 1, 0),
              ('t1notlabelled', 999, 999, 1, 1, 2)`,
      [ranked, unranked],
    );
    await pool.query(`CREATE TABLE chain_rich_list_meta (
        computed_height  INTEGER NOT NULL,
        unattributed_zat BIGINT NOT NULL)`);
    await pool.query("INSERT INTO chain_rich_list_meta VALUES ($1, 0)", [RANK_HEIGHT]);
    app = networkRoutes({} as never, url);
    v1 = v1Routes({ store: new MemoryStorePort(), pool, enabledProtocols: {} });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("reads each address in the order asked, in all three states", async () => {
    const body = await loadLabelledBalances(pool, [absent, ranked, unranked]);
    expect(body).toEqual({
      rankAsOfHeight: RANK_HEIGHT,
      items: [
        { address: absent, balanceZat: 0, rank: null },
        { address: ranked, balanceZat: 43_892_090_013_445, rank: 1 },
        { address: unranked, balanceZat: 2_869_648_329_284, rank: null },
      ],
    });
  });

  it("serves every labelled address and nothing else, with no parameter to widen it", async () => {
    const response = await app.request("/chain/labels/balances?address=t1notlabelled");
    expect(response.status).toBe(200);
    const body = (await response.json()) as LabelledBalances;
    expect(body.items.map((item) => item.address)).toEqual(Object.keys(ADDRESS_LABELS));
    expect(body.rankAsOfHeight).toBe(RANK_HEIGHT);
  });

  it("serves the same figures publicly at /v1/labels, each with its source", async () => {
    const response = await v1.request("/v1/labels");
    expect(response.status).toBe(200);
    const body = (await response.json()) as V1Labels;
    expect(body.labels.map((label) => label.address)).toEqual(Object.keys(ADDRESS_LABELS));
    const byAddress = new Map(body.labels.map((label) => [label.address, label]));
    expect(byAddress.get(ranked)).toMatchObject({ balanceZat: 43_892_090_013_445, rank: 1 });
    expect(byAddress.get(unranked)).toMatchObject({ rank: null, unknowns: { rank: "unmeasured" } });
    expect(byAddress.get(absent)).toMatchObject({
      balanceZat: 0,
      unknowns: { rank: "nonexistent" },
    });
    expect(byAddress.get(ranked)!.source).toBe(ADDRESS_LABELS[ranked]!.source);
    expect(body.rankHeight).toBe(RANK_HEIGHT);
  });
});
