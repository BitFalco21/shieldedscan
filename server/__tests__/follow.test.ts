import { describe, expect, it } from "vitest";
import type { RpcBlock } from "@/data/chain/rpc-types";
import { MemoryChainStore } from "./memory-chain-store";
import {
  DeepReorgError,
  type NodeRpcPort,
  REORG_DEPTH,
  ReconciliationError,
  followOnce,
} from "../follow";
import realBlock from "@/data/chain/__fixtures__/block-3426950.json";

/**
 * The follower is tested against a **real captured block**, re-stamped to different heights,
 * rather than a synthetic one. Its reconciliation gate compares transaction value balances
 * against the node's own pool deltas, so a hand-written block would either have to reproduce
 * that relationship correctly — reimplementing the thing under test — or the gate would be
 * trivially satisfied and prove nothing.
 */

const template = realBlock as unknown as RpcBlock;

/** The real block at a synthetic height, with a hash chain that links up. */
function blockAt(height: number): RpcBlock {
  return {
    ...template,
    height,
    hash: `hash-${height}`.padEnd(64, "0"),
    previousblockhash: `hash-${height - 1}`.padEnd(64, "0"),
  };
}

/** A block whose pool deltas no longer match its transactions — the corruption the gate catches. */
function corruptedAt(height: number): RpcBlock {
  const block = blockAt(height);
  return {
    ...block,
    valuePools: block.valuePools.map((pool) => ({
      ...pool,
      valueDeltaZat: pool.valueDeltaZat === null ? null : pool.valueDeltaZat + 1,
    })),
  };
}

class FakeRpc implements NodeRpcPort {
  constructor(
    private tip: number,
    /** Heights whose hash the node disagrees with us about — simulates a reorg. */
    private readonly forked = new Set<number>(),
    private readonly blockFor: (height: number) => RpcBlock = blockAt,
  ) {}

  getTipHeight(): Promise<number> {
    return Promise.resolve(this.tip);
  }

  getBlockHash(height: number): Promise<string> {
    const suffix = this.forked.has(height) ? "fork" : "";
    return Promise.resolve(`hash-${height}${suffix}`.padEnd(64, "0"));
  }

  getBlock(height: number): Promise<RpcBlock> {
    return Promise.resolve(this.blockFor(height));
  }
}

const silent = () => {};

describe("followOnce", () => {
  it("ingests from genesis on an empty store", async () => {
    const store = new MemoryChainStore();
    const result = await followOnce({ rpc: new FakeRpc(4), store, log: silent, batch: 10 });

    expect(result.ingested).toBe(5);
    expect(result.localTip).toBe(4);
    expect(result.caughtUp).toBe(true);
    expect(store.ingested.map((b) => b.block.height)).toEqual([0, 1, 2, 3, 4]);
  });

  it("stops at the batch limit and reports not caught up", async () => {
    const store = new MemoryChainStore();
    const result = await followOnce({ rpc: new FakeRpc(1000), store, log: silent, batch: 3 });

    expect(result.ingested).toBe(3);
    expect(result.localTip).toBe(2);
    expect(result.caughtUp).toBe(false);
  });

  it("resumes from the stored tip rather than re-ingesting", async () => {
    const store = new MemoryChainStore();
    const deps = { rpc: new FakeRpc(5), store, log: silent, batch: 10 };
    await followOnce({ ...deps, rpc: new FakeRpc(2) });
    store.ingested.length = 0;

    const result = await followOnce(deps);
    expect(store.ingested.map((b) => b.block.height)).toEqual([3, 4, 5]);
    expect(result.ingested).toBe(3);
  });

  it("does nothing when already at the node's tip", async () => {
    const store = new MemoryChainStore();
    const deps = { rpc: new FakeRpc(3), store, log: silent, batch: 10 };
    await followOnce(deps);
    store.ingested.length = 0;

    const result = await followOnce(deps);
    expect(result.ingested).toBe(0);
    expect(result.caughtUp).toBe(true);
  });
});

describe("reorg handling", () => {
  it("rolls back to the common ancestor and re-ingests", async () => {
    const store = new MemoryChainStore();
    await followOnce({ rpc: new FakeRpc(10), store, log: silent, batch: 20 });
    store.ingested.length = 0;

    // The node now disagrees about 8, 9 and 10 — so 7 is the last block we share.
    const forked = new FakeRpc(10, new Set([8, 9, 10]));
    const result = await followOnce({
      rpc: forked,
      store,
      log: silent,
      batch: 20,
      now: () => 1_753_700_000,
    });

    expect(result.rolledBackTo).toBe(7);
    expect(store.ingested.map((b) => b.block.height)).toEqual([8, 9, 10]);
  });

  it("records the reorg with its depth and BOTH hashes, captured before the rows died", async () => {
    const store = new MemoryChainStore();
    await followOnce({ rpc: new FakeRpc(10), store, log: silent, batch: 20 });

    const forked = new FakeRpc(10, new Set([8, 9, 10]));
    await followOnce({ rpc: forked, store, log: silent, batch: 20, now: () => 1_753_700_000 });

    // One event: height 8 is the lowest rolled-back height, three blocks were discarded,
    // and the two hashes are the fact a reader can verify — ours, which only this record
    // now remembers, and the node's replacement.
    expect(store.reorgs).toEqual([
      {
        detectedAt: 1_753_700_000,
        height: 8,
        depth: 3,
        orphanedHash: "hash-8".padEnd(64, "0"),
        replacedBy: "hash-8fork".padEnd(64, "0"),
      },
    ]);
  });

  it("records nothing when nothing diverged", async () => {
    const store = new MemoryChainStore();
    const deps = { rpc: new FakeRpc(6), store, log: silent, batch: 20 };
    await followOnce(deps);
    await followOnce(deps);
    expect(store.reorgs).toEqual([]);
  });

  it("leaves history alone when nothing diverged", async () => {
    const store = new MemoryChainStore();
    const deps = { rpc: new FakeRpc(6), store, log: silent, batch: 20 };
    await followOnce(deps);

    const result = await followOnce(deps);
    expect(result.rolledBackTo).toBeUndefined();
  });

  it("refuses to roll back a divergence deeper than REORG_DEPTH", async () => {
    const store = new MemoryChainStore();
    const tip = REORG_DEPTH + 20;
    await followOnce({ rpc: new FakeRpc(tip), store, log: silent, batch: tip + 1 });

    // Every height within the search window disagrees, so no ancestor is found.
    const allForked = new Set(Array.from({ length: tip + 1 }, (_, i) => i));
    await expect(
      followOnce({ rpc: new FakeRpc(tip, allForked), store, log: silent, batch: 10 }),
    ).rejects.toThrow(DeepReorgError);
    // The refusal rolls back nothing, so there is no event to record — an audit log of
    // rollbacks, not of alarms.
    expect(store.reorgs).toEqual([]);
  });
});

describe("reconciliation gate", () => {
  it("refuses to advance when pool deltas do not match the transactions", async () => {
    const store = new MemoryChainStore();
    const rpc = new FakeRpc(5, new Set(), corruptedAt);

    await expect(followOnce({ rpc, store, log: silent, batch: 10 })).rejects.toThrow(
      ReconciliationError,
    );
    // Nothing may be written: an unreconciled block would corrupt every downstream aggregate.
    expect(store.ingested).toHaveLength(0);
  });

  it("names both pools and both figures in the error, for diagnosis", async () => {
    const store = new MemoryChainStore();
    const rpc = new FakeRpc(0, new Set(), corruptedAt);
    const error = await followOnce({ rpc, store, log: silent, batch: 1 }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ReconciliationError);
    expect((error as Error).message).toMatch(/sapling txs=\d+ pool=\d+/);
    expect((error as Error).message).toMatch(/orchard txs=\d+ pool=\d+/);
  });

  it("passes the gate on the real captured block", async () => {
    const store = new MemoryChainStore();
    const result = await followOnce({ rpc: new FakeRpc(0), store, log: silent, batch: 1 });
    expect(result.ingested).toBe(1);
    // The rollup carries the node's own pool deltas, in domain sign.
    expect(store.ingested[0]?.rollup.saplingFlowZat).toBe(2_250_874_631);
    expect(store.ingested[0]?.rollup.orchardFlowZat).toBe(30_425_428);
  });
});
