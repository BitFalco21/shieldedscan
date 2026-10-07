import { afterAll, describe, expect, it } from "vitest";
import { encodeCursor } from "@/data/cursor";
import { HttpNodeRpc } from "../node-rpc";
import { listBlockRows, readBlockListTips } from "../block-list";
import { NodeChainSource } from "../chain-source";

/**
 * The node-backed chain source, against a real node. Not mocked: the design rests on claims about
 * what the node returns (that `getaddresstxids` exists, that inputs carry no value, that
 * `getblock` inlines transactions), and a mock would encode beliefs rather than test them.
 *
 * Assertions are structural: the chain grows while this runs, so no fixed heights.
 *
 *   TEST_NODE_RPC_URL=http://127.0.0.1:18232 npx vitest run server/__tests__/chain-source.test.ts
 */
const NODE_RPC_URL = process.env.TEST_NODE_RPC_URL;
const describeNode = NODE_RPC_URL ? describe : describe.skip;

describeNode("NodeChainSource", () => {
  const source = new NodeChainSource(new HttpNodeRpc(NODE_RPC_URL!));
  afterAll(() => undefined);
  /** The block list as a site with no chain index serves it: the node alone. */
  const list = async (query: Parameters<typeof listBlockRows>[1]) =>
    listBlockRows({ node: source }, query, await readBlockListTips({ node: source }));

  describe("blocks", () => {
    it("fetches a block by height and by hash identically", async () => {
      const tip = await source.getTipHeight();
      const byHeight = await source.getBlock(String(tip));
      expect(byHeight).toBeDefined();
      const byHash = await source.getBlock(byHeight!.hash);
      expect(byHash).toEqual(byHeight);
    });

    it("returns undefined for a block that does not exist", async () => {
      // Must not throw: routes turn undefined into a designed 404, and an RPC error into 500.
      expect(await source.getBlock("99999999")).toBeUndefined();
      expect(await source.getBlock("nonsense")).toBeUndefined();
    });

    it("lists latest blocks newest-first and contiguous", async () => {
      const blocks = (await list({ limit: 5 })).items;
      expect(blocks).toHaveLength(5);
      const heights = blocks.map((b) => b.height);
      expect(heights).toEqual([...heights].sort((a, b) => b - a));
      // Contiguous: a gap would mean a failed fetch was silently dropped.
      expect(heights[0]! - heights[4]!).toBe(4);
    });

    it("pages blocks without gaps or repeats", async () => {
      const first = await list({ limit: 5 });
      const second = await list({ before: first.nextCursor!, limit: 5 });
      const firstHeights = first.items.map((b) => b.height);
      const secondHeights = second.items.map((b) => b.height);
      expect(firstHeights.filter((h) => secondHeights.includes(h))).toEqual([]);
      expect(Math.max(...secondHeights)).toBe(Math.min(...firstHeights) - 1);
    });

    it("treats a garbage cursor as the first page", async () => {
      const page = await list({ before: encodeCursor("nope", "x"), limit: 3 });
      expect(page.items).toHaveLength(3);
      const heights = page.items.map((b) => b.height);
      expect(heights).toEqual([...heights].sort((a, b) => b - a));
    });

    it("returns a block's transactions, matching its own txid list", async () => {
      const tip = await source.getTipHeight();
      const block = await source.getBlock(String(tip));
      const txs = await source.getBlockTransactions(tip);
      expect(txs.map((t) => t.txid).sort()).toEqual([...block!.txids].sort());
      expect(txs.filter((t) => t.isCoinbase)).toHaveLength(1);
    });
  });

  describe("transactions", () => {
    it("resolves transparent input addresses the RPC does not provide", async () => {
      // The load-bearing claim of this design: inputs arrive as (txid, vout) only, and are
      // filled in by reading the referenced output. Find a transaction that actually has
      // transparent inputs, then check they came back populated.
      const tip = await source.getTipHeight();
      let withInputs: string | undefined;
      for (let h = tip; h > tip - 40 && withInputs === undefined; h -= 1) {
        const txs = await source.getBlockTransactions(h);
        withInputs = txs.find((t) => !t.isCoinbase && t.transparentInputs.length > 0)?.txid;
      }
      expect(withInputs).toBeDefined();

      const tx = await source.getTransaction(withInputs!);
      expect(tx!.transparentInputs.length).toBeGreaterThan(0);
      for (const input of tx!.transparentInputs) {
        expect(input.address).toMatch(/^t[13]/);
        expect(input.valueZat).toBeGreaterThan(0);
      }
    }, 60_000);

    it("derives a fee once inputs are resolved", async () => {
      const tip = await source.getTipHeight();
      let fee: number | null | undefined;
      for (let h = tip; h > tip - 40 && (fee === undefined || fee === null); h -= 1) {
        const txs = await source.getBlockTransactions(h);
        fee = txs.find((t) => !t.isCoinbase && t.feeZat !== null)?.feeZat;
      }
      // A real fee, not zero and not null — the balance equation working end to end.
      expect(fee).toBeGreaterThan(0);
    }, 60_000);

    it("reports coinbase fees as null rather than zero", async () => {
      const tip = await source.getTipHeight();
      const txs = await source.getBlockTransactions(tip);
      const coinbase = txs.find((t) => t.isCoinbase);
      expect(coinbase!.feeZat).toBeNull();
    });

    it("returns undefined for an unknown txid instead of throwing", async () => {
      expect(await source.getTransaction("0".repeat(64))).toBeUndefined();
    });

    it("never fabricates an empty bundle for an untouched pool", async () => {
      const txs = await source.listLatestTransactions(20);
      for (const tx of txs) {
        for (const bundle of [tx.sprout, tx.sapling, tx.orchard]) {
          if (bundle !== null) expect(Object.keys(bundle).length).toBeGreaterThan(0);
        }
      }
    }, 30_000);
  });

  describe("addresses", () => {
    it("reads balance and history from the node's own address index", async () => {
      // A real address from recent chain activity, so this exercises the index rather than a
      // hand-picked one that might not exist.
      const tip = await source.getTipHeight();
      let address: string | undefined;
      for (let h = tip; h > tip - 20 && address === undefined; h -= 1) {
        const txs = await source.getBlockTransactions(h);
        address = txs.flatMap((t) => t.transparentOutputs).find((o) => o.address)?.address;
      }
      expect(address).toBeDefined();

      const info = await source.getAddress(address!);
      expect(info).toBeDefined();
      expect(info!.kind).toBe("transparent");
      if (info!.kind !== "transparent") throw new Error("unreachable");
      // balance = received − sent, which is why no UTXO set is needed.
      expect(info!.balanceZat).toBe(info!.totalReceivedZat - info!.totalSentZat);
      expect(info!.txids.length).toBeGreaterThan(0);
    }, 60_000);

    it("returns undefined for a malformed address rather than throwing", async () => {
      // The node raises `invalid Bech32 encoding` here — it must not reach the route as a 500.
      expect(await source.getAddress("t1NotARealAddressAtAll000000")).toBeUndefined();
    });
  });

  describe("pools", () => {
    it("reports only shielded pools, and omits unmonitored ones", async () => {
      const pools = await source.getPools();
      const names = pools.map((p) => p.pool);
      expect(names).not.toContain("transparent");
      // `ironwood` is monitored:false until NU6.3 activates, so it must be absent — not zero.
      expect(names.every((n) => ["orchard", "sapling", "sprout"].includes(n))).toBe(true);
      expect(pools.every((p) => p.balanceZat > 0)).toBe(true);
    });
  });

  describe("mempool", () => {
    it("lists mempool entries with a null block height and a seen time", async () => {
      const page = await source.listMempool(1, 5);
      // The mempool is legitimately empty sometimes; only the shape is guaranteed.
      for (const entry of page.items) {
        expect(entry.transaction.blockHeight).toBeNull();
        expect(entry.seenAt).toBeGreaterThan(0);
        expect(entry.feeRateZatPerByte).toBeGreaterThanOrEqual(0);
        expect(Array.isArray(entry.dependsOn)).toBe(true);
      }
    }, 30_000);
  });
});
