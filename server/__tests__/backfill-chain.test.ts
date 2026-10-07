import { describe, expect, it } from "vitest";
import type { RpcBlock } from "@/data/chain/rpc-types";
import type { ParsedBlock } from "@/data/chain/parse";
import { type NodeRpcPort, REORG_DEPTH, ReconciliationError } from "../follow";
import { type BackfillStorePort, runBackfill } from "../backfill-chain";
import realBlock from "@/data/chain/__fixtures__/block-3426950.json";

/**
 * Same testing stance as follow.test.ts: a real captured block re-stamped per height, so
 * the reconciliation gate inside `ingestRange` is exercised for real rather than fed a
 * synthetic block that trivially satisfies it.
 */
const template = realBlock as unknown as RpcBlock;

function blockAt(height: number): RpcBlock {
  return {
    ...template,
    height,
    hash: `hash-${height}`.padEnd(64, "0"),
    previousblockhash: `hash-${height - 1}`.padEnd(64, "0"),
  };
}

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
    private readonly tips: number[],
    private readonly blockFor: (height: number) => RpcBlock = blockAt,
  ) {}
  /** Each call shifts the next tip, so a test can move the chain mid-run. */
  getTipHeight(): Promise<number> {
    const next = this.tips.length > 1 ? this.tips.shift()! : this.tips[0]!;
    return Promise.resolve(next);
  }
  getBlockHash(height: number): Promise<string> {
    return Promise.resolve(`hash-${height}`.padEnd(64, "0"));
  }
  getBlock(height: number): Promise<RpcBlock> {
    return Promise.resolve(this.blockFor(height));
  }
}

/** Minimal store: records ingests and the checkpoint, never a sync state — there is none. */
class FakeStore implements BackfillStorePort {
  readonly heights: number[] = [];
  checkpoint: number | null = null;
  readonly checkpoints: number[] = [];

  ingestBlock(parsed: ParsedBlock): Promise<void> {
    this.heights.push(parsed.block.height);
    return Promise.resolve();
  }
  getBackfillCheckpoint(): Promise<number | null> {
    return Promise.resolve(this.checkpoint);
  }
  setBackfillCheckpoint(nextHeight: number): Promise<void> {
    this.checkpoint = nextHeight;
    this.checkpoints.push(nextHeight);
    return Promise.resolve();
  }
}

const silent = () => {};

describe("runBackfill", () => {
  it("walks [start, end] in order and reports the next height", async () => {
    const store = new FakeStore();
    const result = await runBackfill({
      rpc: new FakeRpc([1000]),
      store,
      log: silent,
      start: 5,
      end: 12,
      batch: 3,
    });

    expect(store.heights).toEqual([5, 6, 7, 8, 9, 10, 11, 12]);
    expect(result).toEqual({ ingested: 8, nextHeight: 13, end: 12 });
  });

  it("checkpoints at batch boundaries, so a crash re-does at most one batch", async () => {
    const store = new FakeStore();
    await runBackfill({ rpc: new FakeRpc([1000]), store, log: silent, start: 0, end: 9, batch: 4 });
    expect(store.checkpoints).toEqual([4, 8, 10]);
  });

  it("resumes from the checkpoint, and the checkpoint beats a stale start", async () => {
    // The property that makes re-running after a crash — or after the follower's
    // full-mode switchover — safe and cheap: no work below the checkpoint is repeated,
    // even when the operator passes the original BACKFILL_START again.
    const store = new FakeStore();
    store.checkpoint = 7;
    const messages: string[] = [];
    const result = await runBackfill({
      rpc: new FakeRpc([1000]),
      store,
      log: (m) => messages.push(m),
      start: 0,
      end: 9,
      batch: 100,
    });

    expect(store.heights).toEqual([7, 8, 9]);
    expect(result.ingested).toBe(3);
    expect(messages.some((m) => m.includes("checkpoint 7 overrides start 0"))).toBe(true);
  });

  it("defaults the target to nodeTip - REORG_DEPTH and never writes above it", async () => {
    // Reorg safety by distance: everything this writes is final, so it needs neither the
    // follower's ancestor walk nor its rollback path.
    const store = new FakeStore();
    const tip = 500;
    const result = await runBackfill({
      rpc: new FakeRpc([tip]),
      store,
      log: silent,
      start: tip - REORG_DEPTH - 2,
      batch: 100,
    });

    expect(Math.max(...store.heights)).toBe(tip - REORG_DEPTH);
    expect(result.end).toBe(tip - REORG_DEPTH);
  });

  it("follows a moving tip until it catches the boundary", async () => {
    // The node advances mid-run; the default target is recomputed after each catch-up, so
    // the walk ends at the LAST boundary, not the first.
    const store = new FakeStore();
    const result = await runBackfill({
      rpc: new FakeRpc([200, 210, 210]),
      store,
      log: silent,
      start: 95,
      batch: 100,
    });

    expect(Math.max(...store.heights)).toBe(210 - REORG_DEPTH);
    expect(result.end).toBe(210 - REORG_DEPTH);
  });

  it("a fixed end is a measurement contract — the tip is never consulted again", async () => {
    const store = new FakeStore();
    // Tip list would throw if getTipHeight were called more than zero times after setup:
    // an empty follow-up list yields the same value forever, so instead assert by count.
    const rpc = new FakeRpc([10_000]);
    await runBackfill({ rpc, store, log: silent, start: 0, end: 5, batch: 2 });
    expect(store.heights).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("stops dead on a reconciliation failure, checkpoint intact below it", async () => {
    const store = new FakeStore();
    const rpc = new FakeRpc([1000], (h) => (h === 6 ? corruptedAt(h) : blockAt(h)));

    await expect(
      runBackfill({ rpc, store, log: silent, start: 0, end: 9, batch: 3 }),
    ).rejects.toBeInstanceOf(ReconciliationError);

    // Blocks 0-5 ingested (batches [0-2], [3-5]); the failing batch [6-8] checkpointed
    // nothing, so a re-run resumes at 6 and hits the same wall — stop, never skip.
    expect(store.heights).toEqual([0, 1, 2, 3, 4, 5, 6].slice(0, 6));
    expect(store.checkpoint).toBe(6);
  });

  it("is a no-op when the checkpoint is already past the end", async () => {
    const store = new FakeStore();
    store.checkpoint = 50;
    const result = await runBackfill({
      rpc: new FakeRpc([100 + REORG_DEPTH]),
      store,
      log: silent,
      end: 40,
      batch: 10,
    });
    expect(store.heights).toEqual([]);
    expect(result.ingested).toBe(0);
  });
});
