import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CrossChainTransfer } from "@/domain";
import { MemoryStorePort } from "../crosschain-store";
import { PostgresStorePort } from "../postgres-crosschain-store";

/**
 * `crossChainEdges` over a window with both edges, as `/v1/crosschain/destinations` reads it: `from`
 * inclusive, `to` exclusive, in Postgres exactly as in memory. Its own database, so the suite never
 * truncates a table another suite is reading.
 */
const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

async function createTestDatabase(url: string): Promise<string> {
  const name = "explorer_destinations_window_test";
  const admin = new Pool({ connectionString: withDatabase(url, "postgres"), max: 1 });
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${name}`);
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
  return withDatabase(url, name);
}

const FROM = Date.UTC(2026, 9, 1) / 1000;
const TO = Date.UTC(2026, 10, 1) / 1000;

const transfer = (id: string, timestamp: number, over: Partial<CrossChainTransfer> = {}) =>
  ({
    id,
    direction: "in",
    protocol: "near-intents",
    counterpartChain: "BTC",
    counterpartAsset: "BTC",
    counterpartAmount: 0.01,
    counterpartTxHash: null,
    counterpartIsSynthetic: false,
    counterpartAddress: "bc1qexample",
    zcashTxid: null,
    zcashAddress: "t1Mv595nLBUxJxKAfAZAG9RjhibExEErmMf",
    zecAmountZat: 100_000_000,
    usdValueAtSwap: null,
    counterpartUsdAtSwap: null,
    venueDepositAddress: null,
    status: "completed",
    timestamp,
    ...over,
  }) satisfies CrossChainTransfer;

const UNIFIED =
  "u1l8xunezsvhq8fgzfl7404m450nwnd76zshscn6nfys7vyz2ywyh4cc5daaq0c7q2su5lqfh23sp7fkf3kt27ve5948mzpfdvckzaect2jtte308mkwlycj2u0eac077wu70vqcetkxf";

const ROWS: CrossChainTransfer[] = [
  transfer("before-from", FROM - 1),
  transfer("at-from", FROM, { zcashAddress: UNIFIED }),
  transfer("inside", FROM + 86_400, { zcashAddress: null }),
  transfer("eth-inside", FROM + 3_600, { counterpartChain: "ETH", counterpartAsset: "ETH" }),
  transfer("before-to", TO - 1, { zcashAddress: UNIFIED }),
  transfer("at-to", TO),
  transfer("out-inside", FROM + 7_200, { direction: "out" }),
  transfer("pending-inside", FROM + 10, { status: "pending" }),
];

describeDb("destinations over a window", () => {
  let pg: PostgresStorePort;
  const memory = new MemoryStorePort();

  beforeAll(async () => {
    pg = new PostgresStorePort(await createTestDatabase(DATABASE_URL!));
    await pg.migrate("server/schema.sql");
    await pg.upsert(ROWS);
    await memory.upsert(ROWS);
  });

  afterAll(async () => {
    await pg?.close();
  });

  const sorted = <T extends { chain: string; direction: string; addressKind: string | null }>(
    rows: T[],
  ) =>
    [...rows].sort((a, b) =>
      `${a.chain}${a.direction}${a.addressKind}`.localeCompare(
        `${b.chain}${b.direction}${b.addressKind}`,
      ),
    );

  it("counts from inclusive and to exclusive, completed only", async () => {
    const rows = sorted(await pg.crossChainEdges(FROM, TO));
    expect(rows).toEqual([
      { chain: "BTC", direction: "in", addressKind: null, transfers: 1, zecAmountZat: 100_000_000 },
      {
        chain: "BTC",
        direction: "in",
        addressKind: "unified",
        transfers: 2,
        zecAmountZat: 200_000_000,
      },
      {
        chain: "BTC",
        direction: "out",
        addressKind: "transparent",
        transfers: 1,
        zecAmountZat: 100_000_000,
      },
      {
        chain: "ETH",
        direction: "in",
        addressKind: "transparent",
        transfers: 1,
        zecAmountZat: 100_000_000,
      },
    ]);
  });

  it("answers exactly as the in-memory store does, with either edge open", async () => {
    for (const [from, to] of [
      [FROM, TO],
      [FROM, null],
      [null, TO],
      [null, null],
    ] as const) {
      expect(sorted(await pg.crossChainEdges(from, to))).toEqual(
        sorted(await memory.crossChainEdges(from, to)),
      );
    }
  });
});
