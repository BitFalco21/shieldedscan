import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RpcBlock } from "@/data/chain/rpc-types";
import { HttpNodeRpc, NodeRpcError } from "../node-rpc";
import { listBlockRows, readBlockListTips } from "../block-list";
import { NodeChainSource } from "../chain-source";
import { ByteBudget } from "../v1/byte-budget";
import realBlock from "@/data/chain/__fixtures__/block-3426950.json";

/**
 * What keeps one cheap keyless request from costing the node a lot: a flood of deep 100-block
 * pages must not queue thousands of node reads; search must not resolve every input of a
 * transaction just to say it exists; the address endpoint must not ask the node for a list it then
 * discards (seconds of node work for the busiest addresses).
 */

const template = realBlock as unknown as RpcBlock;
const block = (height: number) => ({ ...template, height, hash: `b${height}`.padEnd(64, "0") });

/** A stub node over `fetch`: answers the tip at once, holds every other call until released. */
function heldNode() {
  const held: Array<() => void> = [];
  const methods: string[] = [];
  const fetchStub = vi.fn(async (_url: string, init?: RequestInit) => {
    const { method, params } = JSON.parse(String(init?.body)) as {
      method: string;
      params: unknown[];
    };
    methods.push(method);
    if (method === "getblockchaininfo") {
      return Response.json({
        result: { blocks: 1000, bestblockhash: "b1000".padEnd(64, "0"), valuePools: [] },
      });
    }
    await new Promise<void>((r) => held.push(r));
    return Response.json({ result: block(Number(params[0])) });
  });
  return {
    fetchStub,
    getblocks: () => methods.filter((m) => m === "getblock").length,
    releaseAll: () => held.splice(0).forEach((r) => r()),
  };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The block list served from the node alone, as a site with no chain index serves it. */
const nodeList = async (source: NodeChainSource, limit: number) =>
  listBlockRows({ node: source }, { limit }, await readBlockListTips({ node: source }));

describe("the public node client's bounded queue", () => {
  it("admits a fan-out only while the queue stays within maxQueued", async () => {
    const node = heldNode();
    vi.stubGlobal("fetch", node.fetchStub);
    const rpc = new HttpNodeRpc("http://node", {
      timeoutMs: 60_000,
      limits: {
        maxInFlight: 2,
        maxWaitMs: 60_000,
        maxQueued: 3,
      },
    });
    // Two free slots, an empty queue: five calls queue three, six would queue four.
    expect(rpc.admits(5)).toBe(true);
    expect(rpc.admits(6)).toBe(false);
    const calls = Array.from({ length: 5 }, (_, i) => rpc.getBlock(i));
    await settle();
    expect(rpc.inFlight).toBe(2);
    expect(rpc.queued).toBe(3);
    expect(rpc.admits(1)).toBe(false);
    for (let round = 0; round < 4; round += 1) {
      node.releaseAll();
      await settle();
    }
    await Promise.all(calls);
    expect(rpc.queued).toBe(0);
    expect(rpc.admits(5)).toBe(true);
    // No bound configured — the follower's and the site's clients — means always yes.
    expect(new HttpNodeRpc("http://node").admits(10_000)).toBe(true);
  });

  it("refuses a block page whole, before a single getblock, when the queue cannot take it", async () => {
    const node = heldNode();
    vi.stubGlobal("fetch", node.fetchStub);
    const source = new NodeChainSource(
      new HttpNodeRpc("http://node", {
        timeoutMs: 60_000,
        limits: { maxInFlight: 2, maxWaitMs: 60_000, maxQueued: 10 },
      }),
    );
    // Twenty rows: two in flight, eighteen to queue against room for ten.
    await expect(nodeList(source, 20)).rejects.toThrow(/node busy: no room to queue/);
    expect(node.getblocks()).toBe(0);
    // A page that fits is served whole.
    const page = nodeList(source, 5);
    for (let round = 0; round < 4; round += 1) {
      await settle();
      node.releaseAll();
    }
    expect((await page).items.map((b) => b.height)).toEqual([1000, 999, 998, 997, 996]);
  });
});

describe("block pages and single reads on separate node slots", () => {
  it("answers a single read while a block page holds every page slot", async () => {
    const held: Array<() => void> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const { method, params } = JSON.parse(String(init?.body)) as {
          method: string;
          params: unknown[];
        };
        if (method === "getblockchaininfo") {
          return Response.json({
            result: { blocks: 1000, bestblockhash: "b1000".padEnd(64, "0"), valuePools: [] },
          });
        }
        // The page's heights are held; anything else answers at once.
        if (Number(params[0]) >= 900) await new Promise<void>((r) => held.push(r));
        return Response.json({ result: block(Number(params[0])) });
      }),
    );
    const singles = new HttpNodeRpc("http://node", {
      timeoutMs: 60_000,
      limits: { maxInFlight: 1, maxWaitMs: 60_000 },
    });
    const pages = new HttpNodeRpc("http://node", {
      timeoutMs: 60_000,
      limits: {
        maxInFlight: 1,
        maxWaitMs: 60_000,
        maxQueued: 10,
      },
    });
    const source = new NodeChainSource(singles, {}, { rpc: pages });
    const page = nodeList(source, 5);
    await settle();
    await settle();
    expect(pages.inFlight).toBe(1);
    expect(pages.queued).toBe(4);
    const single = await Promise.race([
      source.getBlock("5"),
      new Promise<"stuck behind the page">((r) =>
        setTimeout(() => r("stuck behind the page"), 500),
      ),
    ]);
    expect(single).not.toBe("stuck behind the page");
    expect((single as { height: number }).height).toBe(5);
    for (let round = 0; round < 6; round += 1) {
      held.splice(0).forEach((r) => r());
      await settle();
    }
    expect((await page).items).toHaveLength(5);
  });

  it("reads the tip through the one-second memo, not once per page", async () => {
    const getBlockchainInfo = vi.fn(async () => ({
      blocks: 100,
      bestblockhash: "b100".padEnd(64, "0"),
      valuePools: [],
    }));
    const getTipHeight = vi.fn(async () => 100);
    const source = new NodeChainSource({
      getBlockchainInfo,
      getTipHeight,
      admits: () => true,
      getBlock: async (height: number) => block(height),
    } as unknown as HttpNodeRpc);
    await nodeList(source, 2);
    await nodeList(source, 2);
    await nodeList(source, 2);
    expect(getTipHeight).not.toHaveBeenCalled();
    expect(getBlockchainInfo).toHaveBeenCalledTimes(1);
  });
});

describe("an address's balance without its transaction list", () => {
  const rpcWith = (over: Record<string, unknown>) =>
    ({
      getAddressBalance: async () => ({ balance: 5, received: 26_250_106_364_048 }),
      getAddressTxids: vi.fn(async () => {
        throw new NodeRpcError("getaddresstxids", "-32008 Response is too big", -32008);
      }),
      ...over,
    }) as unknown as HttpNodeRpc;

  it("never asks the node for the list of an address that has received", async () => {
    const rpc = rpcWith({});
    const info = await new NodeChainSource(rpc).getAddressBalance(
      "t3dvVE3SQEi7kqNzwrfNePxZ1d4hUyztBA1",
    );
    expect(info).toEqual({
      kind: "transparent",
      address: "t3dvVE3SQEi7kqNzwrfNePxZ1d4hUyztBA1",
      balanceZat: 5,
      totalReceivedZat: 26_250_106_364_048,
      totalSentZat: 26_250_106_364_043,
    });
    expect(
      (rpc as unknown as { getAddressTxids: ReturnType<typeof vi.fn> }).getAddressTxids,
    ).not.toHaveBeenCalled();
  });

  it("falls back to the list only when nothing was received, to tell unused from zero-value", async () => {
    const unused = new NodeChainSource(
      rpcWith({
        getAddressBalance: async () => ({ balance: 0, received: 0 }),
        getAddressTxids: async () => [],
      }),
    );
    expect(await unused.getAddressBalance("t1unused")).toBeUndefined();
    const zeroValue = new NodeChainSource(
      rpcWith({
        getAddressBalance: async () => ({ balance: 0, received: 0 }),
        getAddressTxids: async () => ["ab".repeat(32)],
      }),
    );
    expect((await zeroValue.getAddressBalance("t1zero"))?.balanceZat).toBe(0);
  });

  it("is undefined only for a malformed address, and rejects when the node fails", async () => {
    const malformed = new NodeChainSource(
      rpcWith({
        getAddressBalance: async () => {
          throw new NodeRpcError(
            "getaddressbalance",
            "-5 parse error: invalid Bech32 encoding",
            -5,
          );
        },
      }),
    );
    expect(await malformed.getAddressBalance("t1bad")).toBeUndefined();
    const busy = new NodeChainSource(
      rpcWith({
        getAddressBalance: async () => {
          throw new NodeRpcError("getaddressbalance", "node busy: no RPC slot within 5000 ms");
        },
      }),
    );
    await expect(busy.getAddressBalance("t1busy")).rejects.toThrow(/node busy/);
  });
});

describe("/v1 routes that must not fan out", () => {
  async function v1(chain: Record<string, unknown>, chainIndex?: Record<string, unknown>) {
    const { v1Routes } = await import("../v1/routes");
    const { MemoryStorePort } = await import("../crosschain-store");
    type Deps = Parameters<typeof v1Routes>[0];
    return v1Routes({
      store: new MemoryStorePort(),
      enabledProtocols: {},
      chain: {
        getBlock: async () => undefined,
        getTransaction: vi.fn(async () => {
          throw new Error("search must not resolve a transaction's inputs");
        }),
        getAddress: vi.fn(async () => {
          throw new Error("the address route must not fetch the transaction list");
        }),
        ...chain,
      } as unknown as Deps["chain"],
      ...(chainIndex ? { chainIndex: chainIndex as unknown as Deps["chainIndex"] } : {}),
    });
  }
  const TXID = "ab".repeat(32);

  it("search finds a confirmed transaction through the index, never resolving its inputs", async () => {
    const app = await v1(
      { getRawTransactionHex: vi.fn(async () => undefined) },
      { txBlocks: async () => new Map([[TXID, { height: 5, timestamp: 1 }]]) },
    );
    const body = await (await app.request(`/v1/search?q=${TXID}`)).json();
    expect(body.resolvesTo).toEqual({ type: "transaction", txid: TXID });
  });

  it("search asks the node only for raw bytes when the index does not hold the transaction", async () => {
    const mempool = await v1(
      { getRawTransactionHex: async () => "00" },
      { txBlocks: async () => new Map() },
    );
    expect((await (await mempool.request(`/v1/search?q=${TXID}`)).json()).resolvesTo).toEqual({
      type: "transaction",
      txid: TXID,
    });
    const nowhere = await v1(
      { getRawTransactionHex: async () => undefined },
      { txBlocks: async () => new Map() },
    );
    expect((await (await nowhere.request(`/v1/search?q=${TXID}`)).json()).resolvesTo).toBeNull();
  });

  it("the address route reads the balance alone", async () => {
    const ADDR = "t1a7HnBdsBSvkGZQXD5vPYqoWRvnpG555Jy";
    const app = await v1({
      getAddressBalance: async () => ({
        kind: "transparent",
        address: ADDR,
        balanceZat: 7,
        totalReceivedZat: 10,
        totalSentZat: 3,
      }),
    });
    const res = await app.request(`/v1/addresses/${ADDR}`);
    expect(res.status).toBe(200);
    expect((await res.json()).balanceZat).toBe(7);
  });
});

describe("a byte budget", () => {
  it("grants or refuses a reservation whole, and refills at its rate", () => {
    let now = 0;
    const budget = new ByteBudget(10, 2, () => now);
    expect(budget.reserve(8)).toBe(0);
    // Two left; three needs one more byte at two a second, rounded up to a whole second.
    expect(budget.reserve(3)).toBe(1);
    // The refusal took nothing.
    expect(budget.reserve(2)).toBe(0);
    expect(budget.reserve(6)).toBe(3);
    now = 3_000;
    expect(budget.reserve(6)).toBe(0);
    // Above the capacity is clamped to it, so a full budget never refuses an answer forever.
    now = 1_000_000;
    expect(budget.reserve(50)).toBe(0);
    expect(budget.reserve(1)).toBe(1);
  });
});

describe("the public surface's own index pool", () => {
  /**
   * Wiring at module load, read from the code like `pool-guards.test.ts`: a public flood of wide
   * transactions must not be able to hold every connection of the site's own index store.
   */
  it("hands /v1 and the public chain source an index store of their own, never the site's", () => {
    const read = (file: string) => readFileSync(join(process.cwd(), "server", "app", file), "utf8");
    const v1Call = read("v1.ts").slice(read("v1.ts").indexOf("return v1Routes({"));
    const v1Deps = v1Call.slice(0, v1Call.indexOf("});"));
    expect(v1Deps).toContain("chainIndex: publicChainIndex");
    expect(v1Deps).not.toMatch(/\.\.\.\(chainIndex \?/);
    expect(read("live.ts")).toContain(
      "publicChainIndex ? { blockFees: (h) => publicChainIndex.blockFees(h) }",
    );
  });
});
