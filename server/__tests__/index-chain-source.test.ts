// @vitest-environment node
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { Transaction, ValuePoolName } from "@/domain";
import type { CursorPage } from "@/data/source";
import { NOT_CONFIGURED_HEADER } from "@/data/not-configured";
import type { PulseBlockRow } from "../chain-index-store";
import { IndexChainSource, NoNodeError, type IndexChainReader } from "../index-chain-source";
import { NodeRpcError } from "../node-rpc";

/**
 * An API with a database and no node states the chain as of the newest stored block, from what
 * the node reported when it was stored, and answers every node-only read as an outage.
 */

const HEIGHT = 3_500_000;
const POOLS: Record<ValuePoolName, number | null> = {
  transparent: 500,
  sprout: 20,
  sapling: 300,
  orchard: 400,
  ironwood: null, // not monitored at this block: omitted, never zero
  lockbox: 7,
};

function reader(tip: number | null = HEIGHT): IndexChainReader & {
  listChainTransactions: ReturnType<typeof vi.fn>;
} {
  const row: PulseBlockRow = {
    pools: {
      height: HEIGHT,
      hash: "ab".repeat(32),
      prevHash: "cd".repeat(32),
      timestamp: 1_760_000_000,
      receivedAt: null,
      pools: POOLS,
    },
    txCount: 3,
    totalFeeZat: 1_000,
  };
  const page: CursorPage<Transaction> = { items: [], nextCursor: null, prevCursor: null };
  return {
    tipHeight: () => Promise.resolve(tip),
    blockAt: (h: number) => Promise.resolve(h === HEIGHT ? row : undefined),
    listChainTransactions: vi.fn().mockResolvedValue(page),
    // The block and address reads (`index-chain-reads.test.ts`): an index that holds nothing.
    blockSummaries: () => Promise.resolve(null),
    blockHeightByHash: () => Promise.resolve(null),
    txBlocks: () => Promise.resolve(new Map()),
    addressBalance: () => Promise.resolve({ computedHeight: tip, held: null }),
    addressIoTotals: () => Promise.resolve({ rows: 0, receivedZat: 0, sentZat: 0 }),
    addressTxids: () => Promise.resolve([]),
  };
}

describe("IndexChainSource", () => {
  it("states the tip and its supply as the node reported them at the newest stored block", async () => {
    const source = new IndexChainSource(reader());
    expect(await source.getTip()).toEqual({ height: HEIGHT, hash: "ab".repeat(32) });
    // Every stated pool but the lockbox, which nothing can spend from.
    expect(await source.getChainFacts()).toEqual({
      height: HEIGHT,
      bestBlockHash: "ab".repeat(32),
      lastBlockTimestamp: 1_760_000_000,
      circulatingSupplyZat: 500 + 20 + 300 + 400,
    });
  });

  it("omits a pool the node did not monitor, and states no NSM figure it never stored", async () => {
    const source = new IndexChainSource(reader());
    expect(await source.getPools()).toEqual([
      { pool: "orchard", balanceZat: 400 },
      { pool: "sapling", balanceZat: 300 },
      { pool: "sprout", balanceZat: 20 },
    ]);
    const supply = await source.getSupplyBreakdown();
    expect(supply.nsmZat).toBeNull();
    expect(supply.pools.map((p) => p.pool)).not.toContain("ironwood");
    expect(supply.pools.reduce((s, p) => s + p.balanceZat, 0)).toBe(1_227);
  });

  it("lists the latest transactions from the index, bounded", async () => {
    const r = reader();
    await new IndexChainSource(r).listLatestTransactions(10_000);
    const [kind, query] = r.listChainTransactions.mock.calls[0] as [string, { limit: number }];
    expect(kind).toBe("all");
    expect(query.limit).toBeLessThanOrEqual(100);
  });

  it("an empty index is an outage, never a chain at height 0", async () => {
    await expect(new IndexChainSource(reader(null)).getChainFacts()).rejects.toBeInstanceOf(
      NoNodeError,
    );
  });

  it("every node-only read is an outage with no node code, so nothing reads it as not found", async () => {
    const source = new IndexChainSource(reader());
    const reads = [
      // What the index does not hold: a block, a transaction, an address with no rows.
      source.getBlock("1"),
      source.getTransaction("ef".repeat(32)),
      source.getAddress(`t1${"a".repeat(33)}`),
      source.blocksDescending(10, 5),
      source.getBlockTransactions(1),
      source.getMempoolStats(),
      source.listMempool(1, 25),
      source.getBlockSubsidy(1),
    ];
    for (const read of reads) {
      const err = await read.catch((e: unknown) => e);
      expect(err).toBeInstanceOf(NodeRpcError);
      expect((err as NodeRpcError).code).toBeNull();
    }
  });
});

describe("the index-only chain routes", () => {
  async function app(): Promise<Hono> {
    vi.stubEnv("EXPLORER_API_TOKEN", "x".repeat(40));
    const { mountIndexOnlyRoutes } = await import("../app/node-routes");
    const r = reader();
    const index = {
      ...r,
      blockSummaries: () => Promise.resolve(null),
      blockFees: () => Promise.resolve(new Map()),
      getTransaction: () => Promise.resolve(undefined),
    };
    const hono = new Hono();
    mountIndexOnlyRoutes(hono, {
      source: new IndexChainSource(r),
      chainIndex: index as never,
      log: () => undefined,
    });
    return hono;
  }

  it("answers the tip from the index", async () => {
    const res = await (await app()).request("/chain/info");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { height: number }).height).toBe(HEIGHT);
  });

  it("answers a node-only read 503, marked not configured", async () => {
    const hono = await app();
    for (const path of [
      "/chain/blocks/5",
      "/chain/mempool/stats",
      `/chain/transactions/${"ef".repeat(32)}`,
    ]) {
      const res = await hono.request(path);
      expect(res.status, path).toBe(503);
      expect(res.headers.get(NOT_CONFIGURED_HEADER), path).toBe("1");
    }
  });
});
