import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { blockSummaryOf } from "@/domain";
import { parseBlock } from "@/data/chain/parse";
import type { RpcBlock } from "@/data/chain/rpc-types";
import block460495 from "@/data/chain/__fixtures__/block-460495.json";
import block3426950 from "@/data/chain/__fixtures__/block-3426950.json";
import block3426970 from "@/data/chain/__fixtures__/block-3426970.json";
import block3426987 from "@/data/chain/__fixtures__/block-3426987.json";
import block3426998 from "@/data/chain/__fixtures__/block-3426998.json";
import block3428150 from "@/data/chain/__fixtures__/block-3428150.json";
import block3437300 from "@/data/chain/__fixtures__/block-3437300-coinbase.json";
import { listBlockRows, readBlockListTips } from "../block-list";
import { ChainIndexStore } from "../chain-index-store";
import { PostgresChainStore } from "../postgres-chain-store";

/**
 * The block list's rows from the index against the block the node answers: real captured mainnet
 * blocks go through the follower's own write path into a fresh database, and the row the index
 * builds must equal `blockSummaryOf(parseBlock(raw))` field for field (miner, tag, composition and
 * per-pool counts, reward and funding streams). The fixtures include a Sprout-era block, an
 * Ironwood migration (3,428,150) and a coinbase paying its miner into Ironwood (3,437,300,
 * ZIP 213).
 *
 *   TEST_DATABASE_URL=postgres://postgres:test@localhost:55432/explorer \
 *     npx vitest run server/__tests__/block-summaries-db.test.ts
 */
const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;
const TEST_DB = "explorer_block_summaries_test";

function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

const FIXTURES = [
  block460495,
  block3426950,
  block3426970,
  block3426987,
  block3426998,
  block3428150,
  block3437300,
] as unknown as RpcBlock[];

/** A dense run of synthetic heights for paging, built from one real block. */
const RUN = 9_000_000;
const runBlock = (height: number): RpcBlock => {
  const template = block3426950 as unknown as RpcBlock;
  return {
    ...template,
    height,
    hash: `run-${height}`.padEnd(64, "0"),
    previousblockhash: `run-${height - 1}`.padEnd(64, "0"),
    tx: template.tx.map((tx, i) => ({ ...tx, txid: `run${height}-${i}`.padEnd(64, "0") })),
  };
};

const summaryOf = (raw: RpcBlock) => blockSummaryOf(parseBlock(raw).block);
const withoutFee = <T extends { totalFeeZat: number | null }>(row: T) => ({
  ...row,
  totalFeeZat: null,
});

describeDb("ChainIndexStore.blockSummaries", () => {
  let pool: Pool;
  let index: ChainIndexStore;
  let store: PostgresChainStore;

  beforeAll(async () => {
    const admin = new Pool({ connectionString: withDatabase(DATABASE_URL!, "postgres"), max: 1 });
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${TEST_DB}`);
    await admin.end();
    pool = new Pool({ connectionString: withDatabase(DATABASE_URL!, TEST_DB) });
    store = new PostgresChainStore(pool, { trackSyncState: false });
    await store.applySchema("./server/schema-chain.sql");
    for (const raw of FIXTURES) await store.ingestBlock(parseBlock(raw));
    for (let h = RUN; h < RUN + 7; h += 1) await store.ingestBlock(parseBlock(runBlock(h)));
    index = new ChainIndexStore(pool);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("builds every captured block's list row exactly as the node's parse does", async () => {
    for (const raw of FIXTURES) {
      const got = await index.blockSummaries(raw.height, raw.height);
      expect(got, String(raw.height)).not.toBeNull();
      const row = got![0]!;
      // The parse path never knows the fee (the list path resolves no inputs); the index states
      // what the follower derived, which for these isolated blocks is unknown — their inputs
      // spend outputs this database never saw.
      expect(withoutFee(row), String(raw.height)).toEqual(withoutFee(summaryOf(raw)));
      expect(row.totalFeeZat === null || typeof row.totalFeeZat === "number").toBe(true);
    }
  });

  it("states the reward and streams of a coinbase that pays its miner into Ironwood", async () => {
    const row = (await index.blockSummaries(3_437_300, 3_437_300))![0]!;
    // 12,500,000 zat transparently (the stream) plus 125,513,060 into Ironwood.
    expect(row.miner).toEqual({ kind: "shielded" });
    expect(row.blockRewardZat).toBe(138_013_060);
    expect(row.fundingStreams.reduce((s, f) => s + f.valueZat, 0)).toBe(12_500_000);
  });

  it("answers a range newest first, and an empty range with no rows", async () => {
    const rows = (await index.blockSummaries(RUN, RUN + 6))!;
    expect(rows.map((b) => b.height)).toEqual([6, 5, 4, 3, 2, 1, 0].map((k) => RUN + k));
    expect(await index.blockSummaries(RUN + 3, RUN + 2)).toEqual([]);
  });

  it("pages through the block list, the node supplying what the index has not stored", async () => {
    // The follower is one block behind the node: the list's head must still show that block, and
    // every row below it must be the index's row for the same block the node would have parsed.
    const unstored = runBlock(RUN + 7);
    const nodeChain = new Map<number, RpcBlock>([[RUN + 7, unstored]]);
    for (let h = RUN; h < RUN + 7; h += 1) nodeChain.set(h, runBlock(h));
    const node = {
      getTip: async () => ({ height: RUN + 7, hash: unstored.hash }),
      blocksDescending: async (top: number, count: number) =>
        Array.from({ length: count }, (_, k) => nodeChain.get(top - k))
          .filter((raw): raw is RpcBlock => raw !== undefined)
          .map((raw) => parseBlock(raw).block),
    };
    const sources = { node, index };
    const page = await listBlockRows(sources, { limit: 3 }, await readBlockListTips(sources));
    expect(page.items.map((b) => b.height)).toEqual([RUN + 7, RUN + 6, RUN + 5]);
    expect(page.items.map(withoutFee)).toEqual(
      [RUN + 7, RUN + 6, RUN + 5].map((h) => withoutFee(summaryOf(nodeChain.get(h)!))),
    );
    const next = await listBlockRows(
      sources,
      { limit: 3, before: page.nextCursor! },
      await readBlockListTips(sources),
    );
    expect(next.items.map((b) => b.height)).toEqual([RUN + 4, RUN + 3, RUN + 2]);
  });

  it("hands a range back to the node whenever one row cannot be stated exactly", async () => {
    const h = RUN + 3;
    // A miner not recorded yet.
    await pool.query("UPDATE block SET miner_kind = NULL WHERE height = $1", [h]);
    expect(await index.blockSummaries(h - 1, h + 1)).toBeNull();
    await pool.query("UPDATE block SET miner_kind = 'transparent' WHERE height = $1", [h]);
    expect(await index.blockSummaries(h - 1, h + 1)).not.toBeNull();
    // An ingest seam: the block says one more transaction than the index holds.
    await pool.query("UPDATE block SET tx_count = tx_count + 1 WHERE height = $1", [h]);
    expect(await index.blockSummaries(h - 1, h + 1)).toBeNull();
    await pool.query("UPDATE block SET tx_count = tx_count - 1 WHERE height = $1", [h]);
    // A height missing from the run.
    await pool.query("DELETE FROM block WHERE height = $1", [h]);
    expect(await index.blockSummaries(h - 1, h + 1)).toBeNull();
  });
});
