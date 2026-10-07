import { describe, expect, it } from "vitest";
import type { RpcBlock } from "@/data/chain/rpc-types";
import type { HttpNodeRpc } from "../node-rpc";
import { ORIGIN_CURSOR } from "@/data/cursor";
import { NodeChainSource } from "../chain-source";

/**
 * The transaction walk and its kind filter, against a fake node. A fake is right here (unlike
 * `chain-source.test.ts`): the subject is the walk's own logic (filtering, the block cap, cursor
 * semantics on short pages). The fixture block is a real capture, so the classifier runs on real
 * shapes: per block it yields 1 coinbase, 4 transparent, 3 mixed, 1 fully shielded.
 *
 * Guards against a filter that is accepted and then silently ignored, returning the unfiltered
 * list with no error.
 */
import realBlock from "@/data/chain/__fixtures__/block-3426950.json";

const template = realBlock as unknown as RpcBlock;

function fakeRpc(tip: number): HttpNodeRpc {
  return {
    getTipHeight: () => Promise.resolve(tip),
    getBlock: (height: number) =>
      Promise.resolve({
        ...template,
        height,
        hash: `walk-${height}`.padEnd(64, "0"),
        tx: template.tx.map((tx, i) => ({ ...tx, txid: `t${height}-${i}`.padEnd(64, "0") })),
      }),
    /*
     * The fake must serve source transactions: the resolver refuses to invent a transaction whose
     * inputs it could not resolve, since dropping them would serve a partial input list as whole.
     * This fake stands in for a node that answers, not one that is down.
     */
    getRawTransaction: (txid: string) =>
      Promise.resolve({
        ...template.tx[0],
        txid,
        vout: Array.from({ length: 512 }, (_, n) => ({
          n,
          valueZat: 100_000,
          scriptPubKey: { addresses: [`t1source${n}`] },
        })),
      }),
  } as unknown as HttpNodeRpc;
}

describe("listTransactions kind filter", () => {
  it("returns only the requested kind", async () => {
    const source = new NodeChainSource(fakeRpc(50));
    const page = await source.listTransactions({ limit: 10 }, "shielded");
    expect(page.items.length).toBeGreaterThan(0);
    for (const tx of page.items) {
      expect(tx.sprout ?? tx.sapling ?? tx.orchard).not.toBeNull();
      expect(tx.transparentOutputs).toHaveLength(0);
      expect(tx.isCoinbase).toBe(false);
    }
  });

  it("fills a full page when the kind is common enough", async () => {
    // 1 shielded per block, cap 60 blocks: a 10-item page needs 10 blocks. Well inside.
    const source = new NodeChainSource(fakeRpc(200));
    const page = await source.listTransactions({ limit: 10 }, "shielded");
    expect(page.items).toHaveLength(10);
    expect(page.nextCursor).not.toBeNull();
  });

  it("returns a short page WITH a cursor when the walk cap bites", async () => {
    // The property that matters most: 1 shielded/block × 60-block cap < 100 asked. A null
    // cursor here would tell the UI "shielded history ends after one page" — false, and
    // on a privacy explorer specifically the false claim would be about shielded activity.
    const source = new NodeChainSource(fakeRpc(500));
    const page = await source.listTransactions({ limit: 100 }, "shielded");
    expect(page.items.length).toBeLessThan(100);
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.nextCursor).not.toBeNull();
  });

  it("continues from the short page's cursor without overlap", async () => {
    const source = new NodeChainSource(fakeRpc(500));
    const first = await source.listTransactions({ limit: 100 }, "shielded");
    const second = await source.listTransactions(
      { before: first.nextCursor!, limit: 100 },
      "shielded",
    );
    const seen = new Set(first.items.map((t) => t.txid));
    expect(second.items.some((t) => seen.has(t.txid))).toBe(false);
  });

  it("defaults to all kinds, unfiltered", async () => {
    const source = new NodeChainSource(fakeRpc(50));
    const page = await source.listTransactions({ limit: 9 });
    // The unfiltered walk includes the coinbase: /txs shows the chain as it is.
    expect(page.items).toHaveLength(9);
    expect(page.items.some((t) => t.isCoinbase)).toBe(true);
  });

  it("ends with a null cursor only at genesis", async () => {
    const source = new NodeChainSource(fakeRpc(1));
    const page = await source.listTransactions({ limit: 100 }, "all");
    // Two blocks of nine transactions each, fully consumed: genuinely nothing older.
    expect(page.items).toHaveLength(18);
    expect(page.nextCursor).toBeNull();
  });
});

describe("heavy-address protection", () => {
  const many = Array.from({ length: 5_000 }, (_, i) => `tx${i}`.padEnd(64, "0"));

  function whaleRpc(): HttpNodeRpc {
    let calls = 0;
    return {
      getAddressBalance: () => Promise.resolve({ balance: 1_000, received: 2_000 }),
      getAddressTxids: () => {
        calls += 1;
        if (calls > 1) throw new Error("refetched the unpaginated list within the cache window");
        return Promise.resolve(many);
      },
      getRawTransaction: () => Promise.reject(new Error("not in fake")),
    } as unknown as HttpNodeRpc;
  }

  it("caps the public txid list but keeps balance figures exact", async () => {
    // History pagination lives in the index (`ChainIndexStore.listTransactions`); this path serves only the
    // address summary, so the cap on the raw list is what remains under test here.
    const source = new NodeChainSource(whaleRpc());
    const info = await source.getAddress("t1whale");
    expect(info?.kind).toBe("transparent");
    if (info?.kind !== "transparent") throw new Error("unreachable");
    expect(info.txids.length).toBeLessThanOrEqual(2_000);
    expect(info.totalReceivedZat).toBe(2_000);
  });
});

/**
 * Paging backwards, and reaching the oldest page: `query.after` must be honoured, not just
 * `query.before`. `ORIGIN_CURSOR` is the sentinel the UI sends for "last page": a sort key below
 * every real height, which must land the walk at genesis rather than at the head.
 */
describe("listTransactions cursor direction", () => {
  // The real encoder, not a hand-rolled one: cursors are `sortKey|id` base64url, and a
  // JSON shape decodes to null — which silently falls back to "walk from the tip" and would
  // have made these tests pass against the very bug they exist to catch.

  it("walks UP from an after-cursor instead of restarting at the tip", async () => {
    const source = new NodeChainSource(fakeRpc(500));
    const newest = await source.listTransactions({ limit: 9 });
    const older = await source.listTransactions({ limit: 9, before: newest.nextCursor! });
    const back = await source.listTransactions({ limit: 9, after: older.prevCursor! });

    // Paging back must land near where we started, not at the tip regardless of the cursor.
    const heightOf = (p: typeof back) => p.items[0]?.blockHeight ?? -1;
    expect(heightOf(back)).toBeLessThanOrEqual(heightOf(newest));
    expect(heightOf(back)).toBeGreaterThan(heightOf(older));
  });

  it("reaches genesis for the origin cursor rather than returning the newest page", async () => {
    const source = new NodeChainSource(fakeRpc(500));
    const oldest = await source.listTransactions({ limit: 9, after: ORIGIN_CURSOR });
    const heights = oldest.items.map((t) => t.blockHeight ?? -1);
    expect(heights.length).toBeGreaterThan(0);
    // The whole bug in one assertion: these must be the LOWEST blocks, not the tip.
    expect(Math.min(...heights)).toBe(0);
    expect(Math.max(...heights)).toBeLessThan(50);
  });

  it("has nothing newer at the tip and nothing older at genesis", async () => {
    const source = new NodeChainSource(fakeRpc(500));
    expect((await source.listTransactions({ limit: 9 })).prevCursor).toBeNull();
    const oldest = await source.listTransactions({ limit: 9, after: ORIGIN_CURSOR });
    expect(oldest.nextCursor).toBeNull();
  });

  it("returns newest-first whichever way it walked", async () => {
    // The ascent collects oldest-first; the page contract is newest-first everywhere.
    const source = new NodeChainSource(fakeRpc(500));
    const page = await source.listTransactions({ limit: 9, after: ORIGIN_CURSOR });
    const heights = page.items.map((t) => t.blockHeight ?? 0);
    expect([...heights].sort((a, b) => b - a)).toEqual(heights);
  });
});
