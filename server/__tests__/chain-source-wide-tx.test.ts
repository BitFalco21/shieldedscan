import { describe, expect, it } from "vitest";
import type { RpcBlock } from "@/data/chain/rpc-types";
import type { HttpNodeRpc } from "../node-rpc";
import { NodeChainSource } from "../chain-source";
import realBlock from "@/data/chain/__fixtures__/block-3426950.json";

/**
 * A transaction outside the index has its inputs resolved on the node, one source transaction
 * each. A transaction with thousands of inputs (cheap to broadcast into the mempool) must be
 * refused before any of those fetches start, never resolved in full and never served partially.
 */
const template = realBlock as unknown as RpcBlock;
const spender = template.tx.find((tx) => tx.vin.some((v) => "txid" in v && v.txid))!;
const WIDE = "ab".repeat(32);

function rpcWith(inputs: number) {
  let sourceFetches = 0;
  const wide = {
    ...spender,
    txid: WIDE,
    vin: Array.from({ length: inputs }, (_, i) => ({
      ...spender.vin[0],
      txid: i.toString(16).padStart(64, "0"),
      vout: 0,
    })),
  };
  const rpc = {
    getRawTransaction: (txid: string) => {
      if (txid === WIDE) return Promise.resolve(wide);
      sourceFetches += 1;
      return Promise.resolve({
        ...spender,
        txid,
        vout: [{ n: 0, valueZat: 1_000, scriptPubKey: { addresses: ["t1src"] } }],
      });
    },
  } as unknown as HttpNodeRpc;
  return { rpc, fetches: () => sourceFetches };
}

describe("resolving a wide transaction on the node", () => {
  it("refuses one with too many source transactions, before fetching any", async () => {
    const { rpc, fetches } = rpcWith(5_000);
    await expect(new NodeChainSource(rpc).getTransaction(WIDE)).rejects.toThrow();
    expect(fetches()).toBe(0);
  });

  it("still resolves an ordinary one in full", async () => {
    const { rpc, fetches } = rpcWith(20);
    const tx = await new NodeChainSource(rpc).getTransaction(WIDE);
    expect(tx?.transparentInputs).toHaveLength(20);
    expect(fetches()).toBe(20);
  });
});
