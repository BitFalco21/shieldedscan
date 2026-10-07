import { afterEach, describe, expect, it, vi } from "vitest";
import type { RpcBlock } from "@/data/chain/rpc-types";
import { HttpNodeRpc, NodeRpcError } from "../node-rpc";
import { listBlockRows, readBlockListTips } from "../block-list";
import { NodeChainSource } from "../chain-source";
import realBlock from "@/data/chain/__fixtures__/block-3426950.json";

/**
 * "No such block" is an answer the node gives; everything else is a failure to answer. Treating
 * every error as "not found" yields 404s for blocks that exist and short pages that look whole.
 * The node's own not-found codes: a height past the tip is `-8`, a malformed id `-8`, an unknown
 * block hash `-5`, an unknown or malformed txid `-5`. Those, and only those, mean "not found".
 */

const template = realBlock as unknown as RpcBlock;
const block = (height: number) => ({ ...template, height, hash: `b${height}`.padEnd(64, "0") });

const notInChain = () => new NodeRpcError("getblock", "-8 block height not in best chain", -8);
const unknownHash = () => new NodeRpcError("getblock", "-5 block height not in best chain", -5);
const unknownTx = () =>
  new NodeRpcError("getrawtransaction", "-5 Transaction not found in mempool or best chain", -5);
const busy = (method: string) => new NodeRpcError(method, "node busy: no RPC slot within 5000 ms");
const http429 = (method: string) => new NodeRpcError(method, "HTTP 429");

function fakeRpc(over: Record<string, unknown> = {}): HttpNodeRpc {
  return {
    getBlockchainInfo: async () => ({
      blocks: 100,
      bestblockhash: "b100".padEnd(64, "0"),
      valuePools: [],
    }),
    getTipHeight: async () => 100,
    admits: () => true,
    getBlock: async (height: number) => block(height),
    getBlockByHash: async (hash: string) => ({ ...template, hash }),
    // The fixture's first transaction is its coinbase: no inputs to resolve.
    getRawTransaction: async (txid: string) => ({ ...template.tx[0], txid, hex: "00" }),
    ...over,
  } as unknown as HttpNodeRpc;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("block lookups", () => {
  it("answers undefined only when the node says the block does not exist", async () => {
    const source = new NodeChainSource(
      fakeRpc({
        getBlock: async () => {
          throw notInChain();
        },
        getBlockByHash: async () => {
          throw unknownHash();
        },
      }),
    );
    expect(await source.getBlock("99999999")).toBeUndefined();
    expect(await source.getBlock("ab".repeat(32))).toBeUndefined();
  });

  it("rejects when the node fails to answer, so a route says 503 rather than 404", async () => {
    for (const failure of [busy, http429]) {
      const source = new NodeChainSource(
        fakeRpc({
          getBlock: async () => {
            throw failure("getblock");
          },
        }),
      );
      await expect(source.getBlock("5")).rejects.toBeInstanceOf(NodeRpcError);
    }
  });

  it("rejects a whole list page when one block is refused, never serving a short page", async () => {
    const list = async (source: NodeChainSource) =>
      listBlockRows({ node: source }, { limit: 5 }, await readBlockListTips({ node: source }));
    const page = await list(new NodeChainSource(fakeRpc()));
    expect(page.items.map((b) => b.height)).toEqual([100, 99, 98, 97, 96]);

    const refused = new NodeChainSource(
      fakeRpc({
        getBlock: async (height: number) => {
          if (height === 97) throw busy("getblock");
          return block(height);
        },
      }),
    );
    await expect(list(refused)).rejects.toThrow(/node busy/);
  });

  it("never sends the node anything but a height or a hash", async () => {
    // Modelled on the real node, which answers `getblock "-5"` with the block five below the tip
    // whichever wrapper sends it (both call the same method); the fake must not be written to the
    // fix rather than to the node.
    const getBlock = vi.fn(async (height: number) => block(height));
    const getBlockByHash = vi.fn(async () => block(95));
    const source = new NodeChainSource(fakeRpc({ getBlock, getBlockByHash }));
    for (const id of ["-5", "-1", "1e3", "0x10", "zenith", "ab".repeat(31)]) {
      expect(await source.getBlock(id), id).toBeUndefined();
    }
    expect(getBlock).not.toHaveBeenCalled();
    expect(getBlockByHash).not.toHaveBeenCalled();
    // A real height and a real hash still reach it.
    expect(await source.getBlock("95")).toBeDefined();
    expect(await source.getBlock("AB".repeat(32))).toBeDefined();
    expect(getBlockByHash).toHaveBeenCalledWith("ab".repeat(32));
  });

  it("never fabricates a tip timestamp when the tip block cannot be read", async () => {
    for (const failure of [() => busy("getblock"), notInChain]) {
      const source = new NodeChainSource(
        fakeRpc({
          getBlock: async () => {
            throw failure();
          },
        }),
      );
      await expect(source.getChainFacts()).rejects.toBeInstanceOf(NodeRpcError);
    }
  });
});

describe("transaction lookups", () => {
  it("answers undefined for the node's own 'no such transaction', and rejects on a failure", async () => {
    const missing = new NodeChainSource(
      fakeRpc({
        getRawTransaction: async () => {
          throw unknownTx();
        },
      }),
    );
    expect(await missing.getTransaction("ab".repeat(32))).toBeUndefined();
    expect(await missing.getRawTransactionHex("ab".repeat(32))).toBeUndefined();

    const refused = new NodeChainSource(
      fakeRpc({
        getRawTransaction: async () => {
          throw busy("getrawtransaction");
        },
      }),
    );
    await expect(refused.getTransaction("ab".repeat(32))).rejects.toThrow(/node busy/);
    await expect(refused.getRawTransactionHex("ab".repeat(32))).rejects.toThrow(/node busy/);
  });
});

describe("HttpNodeRpc keeps the node's error code", () => {
  it("carries the code when the node answered, and null when it did not answer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          jsonrpc: "2.0",
          id: 1,
          error: { code: -8, message: "block height not in best chain" },
        }),
      ),
    );
    const answered = await new HttpNodeRpc("http://node").getBlock(99_999_999).catch((e) => e);
    expect(answered).toBeInstanceOf(NodeRpcError);
    expect((answered as NodeRpcError).code).toBe(-8);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("slow down", { status: 429 })),
    );
    const refused = await new HttpNodeRpc("http://node").getBlock(1).catch((e) => e);
    expect(refused).toBeInstanceOf(NodeRpcError);
    expect((refused as NodeRpcError).code).toBeNull();
  });
});

describe("a /v1 caller", () => {
  it("gets 404 for a block the node does not have, and 503 when the node cannot answer", async () => {
    const { v1Routes } = await import("../v1/routes");
    const { MemoryStorePort } = await import("../crosschain-store");
    const app = (rpc: HttpNodeRpc) =>
      v1Routes({
        store: new MemoryStorePort(),
        enabledProtocols: {},
        chain: new NodeChainSource(rpc) as unknown as Parameters<typeof v1Routes>[0]["chain"],
      });

    const missing = app(
      fakeRpc({
        getBlock: async () => {
          throw notInChain();
        },
      }),
    );
    const notFound = await missing.request("/v1/blocks/99999999");
    expect(notFound.status).toBe(404);

    for (const failure of [busy, http429]) {
      const failing = app(
        fakeRpc({
          getBlock: async () => {
            throw failure("getblock");
          },
        }),
      );
      const res = await failing.request("/v1/blocks/5");
      expect(res.status).toBe(503);
      expect((await res.json()).error.code).toBe("upstream_unavailable");
    }
  });
});
