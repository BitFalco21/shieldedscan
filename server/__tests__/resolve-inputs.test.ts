import { describe, expect, it } from "vitest";
import type { RpcBlock } from "@/data/chain/rpc-types";
import type { HttpNodeRpc } from "../node-rpc";
import { NodeChainSource } from "../chain-source";
import realBlock from "@/data/chain/__fixtures__/block-3426950.json";

/**
 * The input resolver must be complete regardless of how far the input count exceeds any
 * internal cache, and an unresolvable input must reject rather than vanish. (A shared LRU that
 * evicts a batch's own sources while the batch is filling it drops inputs nondeterministically;
 * the widest mainnet transaction has 13,538 inputs.)
 */

const template = realBlock as unknown as RpcBlock;

/** A transaction with `inputCount` inputs, each spending a distinct source transaction. */
function blockWithWideTx(inputCount: number): RpcBlock {
  return blockWithWideTxs(1, inputCount);
}

/**
 * `count` transactions of `perTx` inputs each, every input spending a distinct source. A single
 * transaction is capped at 1,000 sources on the node path, so exceeding the 2,000-entry cache
 * takes several of them in one block.
 */
function blockWithWideTxs(count: number, perTx: number): RpcBlock {
  const wides = Array.from({ length: count }, (_, k) => ({
    ...template.tx[1],
    txid: `wide${k}`.padEnd(64, "0"),
    vin: Array.from({ length: perTx }, (_, i) => ({
      txid: `src${k}x${i}`.padEnd(64, "0"),
      vout: 0,
    })),
    vout: [{ n: 0, valueZat: 1_000, scriptPubKey: { addresses: ["t1sink"] } }],
  }));
  return { ...template, tx: [template.tx[0], ...wides] } as unknown as RpcBlock;
}

function rpcFor(block: RpcBlock, onFetch?: () => void): HttpNodeRpc {
  return {
    getTipHeight: () => Promise.resolve(block.height),
    getBlock: () => Promise.resolve(block),
    getRawTransaction: (txid: string) => {
      onFetch?.();
      return Promise.resolve({
        ...template.tx[0],
        txid,
        vout: [{ n: 0, valueZat: 5_000, scriptPubKey: { addresses: ["t1source"] } }],
      });
    },
  } as unknown as HttpNodeRpc;
}

describe("input resolution is complete, not best-effort", () => {
  it("resolves EVERY input of a transaction far wider than the internal cache", async () => {
    // 3 × 900 = 2,700 sources > the 2,000-entry LRU that used to decide the answer. Before
    // the fix this returned roughly 2,000 of them and called it a success.
    const source = new NodeChainSource(rpcFor(blockWithWideTxs(3, 900)));
    const txs = await source.getBlockTransactions(1);
    const wides = txs.filter((t) => t.txid.startsWith("wide"));
    expect(wides, "a wide transaction is missing entirely").toHaveLength(3);
    for (const wide of wides) expect(wide.transparentInputs).toHaveLength(900);
  });

  it("is deterministic — the same transaction twice yields the same input count", async () => {
    // More sources than the cache holds.
    const source = new NodeChainSource(rpcFor(blockWithWideTxs(3, 900)));
    const first = (await source.getBlockTransactions(1)).find((t) => t.txid.startsWith("wide"));
    const second = (await source.getBlockTransactions(1)).find((t) => t.txid.startsWith("wide"));
    expect(second!.transparentInputs).toHaveLength(first!.transparentInputs.length);
  });

  it("rejects rather than silently shortening the list when the node fails", async () => {
    // `ExplorerDataSource`'s contract: a transient failure must REJECT. Catching it and
    // returning fewer inputs dresses an outage up as data, which is the one thing this
    // codebase refuses everywhere else.
    const rpc = {
      getTipHeight: () => Promise.resolve(1),
      getBlock: () => Promise.resolve(blockWithWideTx(10)),
      getRawTransaction: () => Promise.reject(new Error("node unreachable")),
    } as unknown as HttpNodeRpc;
    await expect(new NodeChainSource(rpc).getBlockTransactions(1)).rejects.toThrow();
  });

  it("does not open one node connection per input", async () => {
    /*
     * Concurrency is bounded: one request must not fire thousands of concurrent RPC calls at
     * the node. Asserted by watching the fetches in flight, not by reading the constant.
     */
    let inFlight = 0;
    let peak = 0;
    const rpc = {
      getTipHeight: () => Promise.resolve(1),
      getBlock: () => Promise.resolve(blockWithWideTx(400)),
      getRawTransaction: async (txid: string) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await Promise.resolve();
        inFlight -= 1;
        return {
          ...template.tx[0],
          txid,
          vout: [{ n: 0, valueZat: 5_000, scriptPubKey: { addresses: ["t1source"] } }],
        };
      },
    } as unknown as HttpNodeRpc;
    await new NodeChainSource(rpc).getBlockTransactions(1);
    expect(peak, `peaked at ${peak} concurrent node calls for 400 inputs`).toBeLessThanOrEqual(64);
  });

  it("keeps an input whose script names no address, rather than dropping it", async () => {
    /*
     * An output with no single standard address resolves to "" (the domain's convention,
     * which `ChainIndexStore` also emits), never [], so both paths agree on the input count.
     */
    const rpc = {
      getTipHeight: () => Promise.resolve(1),
      getBlock: () => Promise.resolve(blockWithWideTx(3)),
      getRawTransaction: (txid: string) =>
        Promise.resolve({
          ...template.tx[0],
          txid,
          vout: [{ n: 0, valueZat: 5_000, scriptPubKey: {} }],
        }),
    } as unknown as HttpNodeRpc;
    const txs = await new NodeChainSource(rpc).getBlockTransactions(1);
    const wide = txs.find((t) => t.txid.startsWith("wide"));
    expect(wide!.transparentInputs).toHaveLength(3);
    expect(wide!.transparentInputs.every((i) => i.address === "")).toBe(true);
  });
});
