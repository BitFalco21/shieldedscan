// @vitest-environment node
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import {
  blockSummaryOf,
  hasBlockHeader,
  type Block,
  type BlockSummary,
  type Transaction,
} from "@/domain";
import type { CursorPage } from "@/data/source";
import { NOT_CONFIGURED_HEADER } from "@/data/not-configured";
import { WINDOW_IO_ROWS } from "../address-extremes";
import type { ChainIndexStore } from "../chain-index-store";
import { MemoryStorePort } from "../crosschain-store";
import { IndexChainSource, NoNodeError, type IndexChainReader } from "../index-chain-source";
import { type V1ChainPort, v1Routes } from "../v1/routes";

/**
 * Without a node, a block, a transaction and an address are answered from the index as of its
 * newest block, and only what the index cannot state is an outage: never a header field, never a
 * balance it cannot prove, never "not found" for something that may come after the tip.
 */

const TIP = 3_500_000;
const HEIGHT = 3_499_990;

const FULL: Block = {
  height: HEIGHT,
  hash: "ab".repeat(32),
  prevHash: "cd".repeat(32),
  timestamp: 1_760_000_000,
  sizeBytes: 4_000,
  txids: ["c0".repeat(32), "c1".repeat(32)],
  version: 4,
  difficulty: 146_914_688.75,
  bits: "1c00e9e0",
  nonce: "4e".repeat(32),
  merkleRoot: "4d".repeat(32),
  finalSaplingRoot: "5a".repeat(32),
  finalOrchardRoot: "04".repeat(32),
  composition: {
    transparentTxs: 1,
    mixedTxs: 0,
    shieldedTxs: 1,
    byPool: { ironwood: 0, orchard: 1, sapling: 0, sprout: 0 },
  },
  miner: { kind: "transparent", address: `t1${"m".repeat(33)}` },
  coinbaseTag: "pool",
  fundingStreams: [{ address: `t3${"s".repeat(33)}`, valueZat: 12_500_000 }],
  blockRewardZat: 156_250_000,
  totalFeeZat: 20_000,
};
/** What the index states for that block: its list row. */
const ROW: BlockSummary = blockSummaryOf(FULL);
const TXID = "ef".repeat(32);

const FUNDED = `t1${"f".repeat(33)}`;
const EMPTIED = `t1${"e".repeat(33)}`;
const BUSY = `t1${"b".repeat(33)}`;
const BROKEN = `t1${"x".repeat(33)}`;
const UNSEEN = `t1${"u".repeat(33)}`;

const EMPTY_PAGE: CursorPage<Transaction> = { items: [], nextCursor: null, prevCursor: null };

function reader(opts: { computedHeight?: number } = {}): IndexChainReader {
  return {
    tipHeight: () => Promise.resolve(TIP),
    blockAt: () => Promise.resolve(undefined),
    listChainTransactions: () => Promise.resolve(EMPTY_PAGE),
    blockSummaries: (lo: number, hi: number) =>
      Promise.resolve(lo === HEIGHT && hi === HEIGHT ? [ROW] : null),
    blockHeightByHash: (hash: string) => Promise.resolve(hash === ROW.hash ? HEIGHT : null),
    txBlocks: (ids: readonly string[]) =>
      Promise.resolve(
        new Map(ids.includes(TXID) ? [[TXID, { height: HEIGHT, timestamp: ROW.timestamp }]] : []),
      ),
    addressBalance: (address: string) =>
      Promise.resolve({
        computedHeight: opts.computedHeight ?? TIP,
        held: address === FUNDED ? { balanceZat: 700, receivedZat: 1_000 } : null,
      }),
    addressIoTotals: (address: string, _at: number, maxRows: number) =>
      Promise.resolve(
        address === EMPTIED
          ? { rows: 4, receivedZat: 500, sentZat: 500 }
          : address === BROKEN
            ? { rows: 2, receivedZat: 500, sentZat: 100 }
            : address === BUSY
              ? { rows: maxRows + 1, receivedZat: 9, sentZat: 0 }
              : { rows: 0, receivedZat: 0, sentZat: 0 },
      ),
    addressTxids: () => Promise.resolve(["c1".repeat(32)]),
  };
}

async function outage(read: Promise<unknown>): Promise<unknown> {
  return read.then(
    () => "answered",
    (e: unknown) => e,
  );
}

describe("IndexChainSource blocks and transactions", () => {
  const source = new IndexChainSource(reader());

  it("states a stored block as its list row, by height or hash, its header not read", async () => {
    for (const id of [String(HEIGHT), ROW.hash, ROW.hash.toUpperCase()]) {
      const block = await source.getBlock(id);
      expect(block, id).toEqual(ROW);
      expect(hasBlockHeader(block!)).toBe(false);
    }
  });

  it("a height above the newest stored block, or an unknown hash, is an outage, not a miss", async () => {
    for (const id of [String(TIP + 1), "99".repeat(32)]) {
      expect(await outage(source.getBlock(id)), id).toBeInstanceOf(NoNodeError);
    }
  });

  it("a block whose stored rows cannot state it exactly is an outage, never a partial row", async () => {
    expect(await outage(source.getBlock(String(HEIGHT - 1)))).toBeInstanceOf(NoNodeError);
  });

  it("is not found only where the index proves it: no id at all, or the other kind of id", async () => {
    expect(await source.getBlock("not-a-block")).toBeUndefined();
    expect(await source.getBlock(TXID)).toBeUndefined();
    expect(await source.getTransaction("xyz")).toBeUndefined();
    expect(await source.getTransaction(ROW.hash)).toBeUndefined();
    expect(await outage(source.getTransaction("99".repeat(32)))).toBeInstanceOf(NoNodeError);
  });
});

describe("IndexChainSource addresses", () => {
  const source = new IndexChainSource(reader());

  it("a funded address is its stored balance; sent is received minus balance", async () => {
    expect(await source.getAddressBalance(FUNDED)).toEqual({
      kind: "transparent",
      address: FUNDED,
      balanceZat: 700,
      totalReceivedZat: 1_000,
      totalSentZat: 300,
    });
  });

  it("an emptied address is zero, with received and sent summed from its rows", async () => {
    expect(await source.getAddressBalance(EMPTIED)).toEqual({
      kind: "transparent",
      address: EMPTIED,
      balanceZat: 0,
      totalReceivedZat: 500,
      totalSentZat: 500,
    });
  });

  it("carries its newest txids", async () => {
    const info = await source.getAddress(FUNDED);
    expect(info).toMatchObject({ kind: "transparent", txids: ["c1".repeat(32)] });
  });

  it("an address with no rows, or more than one read may walk, is an outage", async () => {
    for (const address of [UNSEEN, BUSY]) {
      expect(await outage(source.getAddress(address)), address).toBeInstanceOf(NoNodeError);
    }
  });

  it("balances that cover another height than the newest block are not stated", async () => {
    const stale = new IndexChainSource(reader({ computedHeight: TIP - 1 }));
    expect(await outage(stale.getAddressBalance(FUNDED))).toBeInstanceOf(NoNodeError);
  });

  it("rows that contradict the balances fail loudly, never as a figure", async () => {
    const err = await outage(source.getAddressBalance(BROKEN));
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(NoNodeError);
  });

  it("a string that is no transparent address has no balance, as on the node", async () => {
    expect(await source.getAddress("t1short")).toBeUndefined();
    expect(await source.getAddress(`zs1${"q".repeat(70)}`)).toBeUndefined();
  });

  it("walks at most the bounded number of rows", async () => {
    const r = reader();
    const spy = vi.spyOn(r, "addressIoTotals");
    await new IndexChainSource(r).getAddressBalance(EMPTIED);
    expect(spy.mock.calls[0]?.[1]).toBe(TIP);
    expect(spy.mock.calls[0]?.[2]).toBe(WINDOW_IO_ROWS);
  });
});

/** The index the routes read beside the source. */
function chainIndex(r: IndexChainReader) {
  return {
    ...r,
    listBlockTransactions: vi.fn().mockResolvedValue(EMPTY_PAGE),
    getTransaction: () => Promise.resolve(undefined),
    addressActivityExtent: () => Promise.resolve({ first: null, last: null }),
    blockFees: () => Promise.resolve(new Map()),
  };
}

describe("the site's chain routes without a node", () => {
  async function app() {
    vi.stubEnv("EXPLORER_API_TOKEN", "x".repeat(40));
    const { mountIndexOnlyRoutes } = await import("../app/node-routes");
    const r = reader();
    const index = chainIndex(r);
    const hono = new Hono();
    mountIndexOnlyRoutes(hono, {
      source: new IndexChainSource(r),
      chainIndex: index as unknown as ChainIndexStore,
      log: () => undefined,
      tipTimeMs: null,
    });
    return { hono, index };
  }

  it("answers a block page's block and its transactions from the index", async () => {
    const { hono, index } = await app();
    const res = await hono.request(`/chain/blocks/${ROW.hash}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(ROW);
    expect((await hono.request(`/chain/blocks/${HEIGHT}/transactions`)).status).toBe(200);
    expect(index.listBlockTransactions.mock.calls[0]?.[0]).toBe(HEIGHT);
  });

  it("answers an address's balance", async () => {
    const res = await (await app()).hono.request(`/chain/addresses/${FUNDED}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ balanceZat: 700, totalSentZat: 300 });
  });

  it("a block hash is no transaction, so a search for one is not an outage", async () => {
    expect((await (await app()).hono.request(`/chain/transactions/${ROW.hash}`)).status).toBe(404);
  });

  it("what it cannot state stays 503, marked not configured", async () => {
    const { hono } = await app();
    for (const path of [`/chain/blocks/${TIP + 1}`, `/chain/addresses/${UNSEEN}`]) {
      const res = await hono.request(path);
      expect(res.status, path).toBe(503);
      expect(res.headers.get(NOT_CONFIGURED_HEADER), path).toBe("1");
    }
  });
});

describe("/v1 without a node", () => {
  function app(chain: V1ChainPort = new IndexChainSource(reader())) {
    return v1Routes({
      chain,
      chainIndex: chainIndex(reader()) as unknown as ChainIndexStore,
      store: new MemoryStorePort(),
      enabledProtocols: {},
    });
  }
  const body = async (res: Response) => {
    const { asOf: _asOf, ...rest } = (await res.json()) as Record<string, unknown>;
    return rest;
  };

  it("states a block exactly as the node path states the same block", async () => {
    // The route reads only `getBlock`; the node's answer is the whole block.
    const node = app({
      getBlock: () => Promise.resolve(FULL),
    } as Partial<V1ChainPort> as V1ChainPort);
    const [fromIndex, fromNode] = await Promise.all([
      app().request(`/v1/blocks/${HEIGHT}`),
      node.request(`/v1/blocks/${HEIGHT}`),
    ]);
    expect(fromIndex.status).toBe(200);
    expect(fromNode.status).toBe(200);
    expect(await body(fromIndex)).toEqual(await body(fromNode));
  });

  it("pages a block's transactions", async () => {
    expect((await app().request(`/v1/blocks/${ROW.hash}/transactions`)).status).toBe(200);
  });

  it("answers an address", async () => {
    const res = await app().request(`/v1/addresses/${EMPTIED}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ balanceZat: 0, totalReceivedZat: 500 });
    expect((await app().request(`/v1/addresses/${UNSEEN}`)).status).toBe(503);
  });

  it("searches a height, a block hash and a txid", async () => {
    const resolves = async (q: string) =>
      ((await (await app().request(`/v1/search?q=${q}`)).json()) as { resolvesTo: unknown })
        .resolvesTo;
    expect(await resolves(String(HEIGHT))).toEqual({
      type: "block",
      height: HEIGHT,
      hash: ROW.hash,
    });
    expect(await resolves(ROW.hash)).toEqual({ type: "block", height: HEIGHT, hash: ROW.hash });
    expect(await resolves(TXID)).toEqual({ type: "transaction", txid: TXID });
    expect((await app().request(`/v1/search?q=${"99".repeat(32)}`)).status).toBe(503);
  });
});
