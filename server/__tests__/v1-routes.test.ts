import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Pool } from "pg";
import {
  blockSummaryOf,
  type MempoolStats,
  type SupplyBreakdown,
  type Transaction,
} from "@/domain";
import type { BlockRowsReader } from "../block-list";
import type { ChainIndexStore } from "../chain-index-store";
import { MemoryStorePort } from "../crosschain-store";
import { V1_ADDRESS_WINDOW_REGEXP } from "../v1/address-windows";
import { type V1ChainPort, v1Routes } from "../v1/routes";
import { ByteBudget } from "../v1/byte-budget";
import { LABELS_NOTICE } from "../v1/map";
import type { V1Labels } from "../v1/dto";
import { ADDRESS_LABELS } from "@/domain";

/**
 * The public contract, tested at the HTTP boundary via `app.request()` (no server, no network):
 * the error envelope, the always-present nulls with reasons, unknown-parameter rejection, and
 * the cache headers.
 */

const SPROUT_ONLY_TX: Transaction = {
  txid: "ab".repeat(32),
  blockHeight: 100,
  blockHash: "cd".repeat(32),
  timestamp: 1_500_000_000,
  isCoinbase: false,
  version: 2,
  sizeBytes: 1000,
  lockTime: 0,
  expiryHeight: null,
  rawHex: null,
  feeZat: null,
  bindingSigValid: null,
  transparentInputs: [],
  transparentOutputs: [],
  sprout: { joinSplits: 2 },
  sapling: null,
  orchard: null,
  ironwood: null,
};

const SUPPLY: SupplyBreakdown = {
  height: 3_429_000,
  pools: [
    // ~15.6M ZEC transparent — the fixture must stay inside MAX_SUPPLY, or
    // unminedZat correctly clamps to 0 and the partition identity cannot hold.
    { pool: "transparent", balanceZat: 1_560_000_000_000_000 },
    { pool: "sprout", balanceZat: 2_994_923_783 },
    { pool: "sapling", balanceZat: 5_900_000_000_000 },
    { pool: "orchard", balanceZat: 36_000_000_000_000 },
    { pool: "ironwood", balanceZat: 1_700_000_000_000 },
    { pool: "lockbox", balanceZat: 800_000_000_000 },
  ],
};

const MEMPOOL: MempoolStats = {
  pendingCount: 12,
  totalSizeBytes: 34_000,
  medianFeeZat: null,
  medianFeeRateZatPerByte: null,
  composition: null,
};

function chainPort(overrides: Partial<V1ChainPort> = {}): V1ChainPort {
  return {
    getChainFacts: async () => ({
      height: 3_429_000,
      bestBlockHash: "00".repeat(32),
      lastBlockTimestamp: 1_785_000_000,
      circulatingSupplyZat: 16_000_000_00000000,
    }),
    getSupplyBreakdown: async () => SUPPLY,
    getTransaction: async () => undefined,
    getTip: async () => ({ height: 3_429_000, hash: "00".repeat(32) }),
    blocksDescending: async () => [],
    getBlock: async () => undefined,
    getBlockTransactions: async () => [],
    getAddress: async () => undefined,
    getMempoolStats: async () => MEMPOOL,
    // Figures as the live node returns them, per height era.
    getBlockSubsidy: async (height: number) =>
      height >= 4_406_400
        ? {
            miner: 0.78125,
            founders: 0,
            fundingstreamstotal: 0,
            lockboxtotal: 0,
            totalblocksubsidy: 0.78125,
          }
        : {
            miner: 1.25,
            founders: 0,
            fundingstreamstotal: 0.125,
            lockboxtotal: 0.1875,
            totalblocksubsidy: 1.5625,
            // Verbatim from the live node, labels included: it reports the older "Major Grants" /
            // "Lockbox NU6" names for the slots ZIP 214 revision 2 directs to the FPF and the
            // lockbox. Kept untidied so the stub reproduces the discrepancy the DTO documents.
            fundingstreams: [
              {
                recipient: "Major Grants",
                specification: "https://zips.z.cash/zip-0214",
                value: 0.125,
                valueZat: 12_500_000,
                address: "t3cFfPt1Bcvgez9ZbMBFWeZsskxTkPzGCow",
              },
            ],
            lockboxstreams: [
              {
                recipient: "Lockbox NU6",
                specification: "https://zips.z.cash/zip-0214",
                value: 0.1875,
                valueZat: 18_750_000,
              },
            ],
          },
    ...overrides,
  };
}

function appWith(
  overrides: Partial<V1ChainPort> = {},
  extra: { blockRows?: BlockRowsReader; chainIndex?: ChainIndexStore } = {},
) {
  return v1Routes({
    chain: chainPort(overrides),
    store: new MemoryStorePort(),
    enabledProtocols: { maya: true, "near-intents": true, thorchain: false },
    ...extra,
  });
}

describe("a capped transaction side never passes for a complete one", () => {
  /**
   * The cap on `transparentInputs` is legitimate only because the true count is always emitted
   * and `truncated` names what was withheld, so no consumer can mistake the array for the whole.
   */
  const wideTx = (inputs: number) =>
    ({
      txid: "c8".repeat(32),
      blockHeight: 100,
      blockHash: "b".repeat(64),
      timestamp: 1_785_000_000,
      isCoinbase: false,
      version: 5,
      sizeBytes: 1_996_848,
      lockTime: 0,
      expiryHeight: null,
      rawHex: null,
      feeZat: 1_000_000,
      bindingSigValid: null,
      transparentInputs: Array.from({ length: inputs }, (_, i) => ({
        address: `t1in${i}`,
        valueZat: 1_000,
      })),
      transparentOutputs: [{ address: "t1out", valueZat: 500 }],
      sprout: null,
      sapling: null,
      orchard: null,
      ironwood: null,
    }) as never;

  it("emits the TRUE count even when the array is capped", async () => {
    const app = appWith({ getTransaction: async () => wideTx(13_538) });
    const body = (await (await app.request(`/v1/transactions/${"c8".repeat(32)}`)).json()) as {
      transparentInputs: unknown[];
      transparentInputCount: number;
      truncated?: { transparentInputs?: { returned: number; total: number; resumeWith: string } };
    };
    expect(body.transparentInputs.length).toBe(1_000);
    // The fact, not the window.
    expect(body.transparentInputCount).toBe(13_538);
    expect(body.truncated?.transparentInputs).toEqual({
      returned: 1_000,
      total: 13_538,
      resumeWith: "inputsFrom=1000",
    });
  });

  it("returns the remainder from the offset it told you to use", async () => {
    // Nothing is unreachable: the rest pages in.
    const app = appWith({ getTransaction: async () => wideTx(13_538) });
    const body = (await (
      await app.request(`/v1/transactions/${"c8".repeat(32)}?inputsFrom=13000`)
    ).json()) as { transparentInputs: { address: string }[]; truncated?: unknown };
    expect(body.transparentInputs).toHaveLength(538);
    expect(body.transparentInputs[0]!.address).toBe("t1in13000");
    // The last page is not flagged truncated; a short answer that IS complete says so.
    expect(body.truncated).toBeUndefined();
  });

  it("says nothing about truncation for an ordinary transaction", async () => {
    const app = appWith({ getTransaction: async () => wideTx(3) });
    const body = (await (await app.request(`/v1/transactions/${"c8".repeat(32)}`)).json()) as {
      transparentInputCount: number;
      truncated?: unknown;
    };
    expect(body.transparentInputCount).toBe(3);
    expect(body.truncated).toBeUndefined();
  });
});

describe("the cursor alias", () => {
  /**
   * `cursor` exists because `before`/`after` is easy to get backwards (this API pairs
   * `nextCursor` with `before`, the opposite of Relay-style APIs). Asserts the alias reaches the
   * store as `before`.
   */
  const seen: { before?: string; after?: string }[] = [];
  const appWithSpy = () =>
    appWith(
      {},
      {
        blockRows: async (q) => {
          seen.push({
            ...(q.before ? { before: q.before } : {}),
            ...(q.after ? { after: q.after } : {}),
          });
          return { items: [], nextCursor: null, prevCursor: null, feesStated: false };
        },
      },
    );

  it("forwards ?cursor= as `before`, so nextCursor pages forward", async () => {
    seen.length = 0;
    const res = await appWithSpy().request("/v1/blocks?cursor=abc123");
    expect(res.status).toBe(200);
    expect(seen[0]).toEqual({ before: "abc123" });
  });

  it("still accepts before and after unchanged — a published contract", async () => {
    seen.length = 0;
    await appWithSpy().request("/v1/blocks?before=x");
    await appWithSpy().request("/v1/blocks?after=y");
    expect(seen).toEqual([{ before: "x" }, { after: "y" }]);
  });

  it("rejects cursor alongside before or after rather than picking a winner", async () => {
    // Two names for one slot with a silent winner would page somewhere the caller did not ask for.
    for (const q of ["cursor=a&before=b", "cursor=a&after=b"]) {
      const res = await appWithSpy().request(`/v1/blocks?${q}`);
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("invalid_parameter");
    }
  });

  it("is accepted on every cursored list, not just blocks", async () => {
    // The alias must work on every cursored endpoint, or callers learn a false rule.
    for (const path of [
      "/v1/blocks",
      "/v1/transactions",
      "/v1/crosschain/transfers",
      "/v1/reorgs",
    ]) {
      const res = await appWith({}).request(`${path}?cursor=abc`);
      expect([200, 503], `${path} rejected the cursor alias`).toContain(res.status);
    }
  });
});

describe("tier B endpoints", () => {
  it("/v1/blocks states a list fee as omitted when no index was read — never a per-row walk", async () => {
    const block = {
      height: 100,
      hash: "a".repeat(64),
      prevHash: "b".repeat(64),
      timestamp: 1_785_000_000,
      sizeBytes: 2000,
      txids: ["t1", "t2"],
      difficulty: 1.5,
      miner: { kind: "transparent", address: "t1miner" },
      coinbaseTag: null,
      composition: {
        transparentTxs: 2,
        mixedTxs: 0,
        shieldedTxs: 0,
        byPool: { ironwood: 0, orchard: 0, sapling: 0, sprout: 0 },
      },
      totalFeeZat: 12345,
      // Required by the domain `Block` (this literal is cast, so the compiler cannot say so). A
      // funding stream keeps `minerRewardZat` a real subtraction rather than an identity.
      fundingStreams: [{ address: "t3stream", valueZat: 25_000_000 }],
      blockRewardZat: 156_250_000,
    };
    const node = {
      getTip: async () => ({ height: 100, hash: block.hash }),
      blocksDescending: async () => [block] as never[],
      getBlock: async () => block as never,
    };
    const app = appWith(node);
    const list = (await (await app.request("/v1/blocks")).json()) as {
      items: Record<string, unknown>[];
    };
    const row = list.items[0]!;
    expect(row.totalFeeZat).toBeNull();
    expect((row.unknowns as Record<string, string>).totalFeeZat).toBe("omitted");
    // The detail carries the real figure.
    const detail = (await (await app.request("/v1/blocks/100")).json()) as Record<string, unknown>;
    expect(detail.totalFeeZat).toBe(12345);
    expect(detail.unknowns).toBeUndefined();

    // With the index, the list states the fee the follower derived, read off the block row.
    const index = {
      tipHeight: async () => 100,
      blockSummaries: async () => [blockSummaryOf(block as never)],
      blockFees: async () => new Map(),
    } as unknown as ChainIndexStore;
    const indexed = (await (
      await appWith(node, { chainIndex: index }).request("/v1/blocks")
    ).json()) as {
      items: Record<string, unknown>[];
    };
    expect(indexed.items[0]!.totalFeeZat).toBe(12345);
    expect(indexed.items[0]!.unknowns).toBeUndefined();
  });

  it("/v1/blocks serves the reward and its split, and shields it rather than nulling it blind", async () => {
    /*
     * Block reward and funding streams are published, with the miner's share handed over derived
     * rather than as terms a consumer would have to combine.
     */
    const transparent = {
      height: 100,
      hash: "a".repeat(64),
      prevHash: "b".repeat(64),
      timestamp: 1_785_000_000,
      sizeBytes: 2000,
      txids: ["t1"],
      difficulty: 1.5,
      miner: { kind: "transparent", address: "t1miner" },
      coinbaseTag: null,
      composition: {
        transparentTxs: 1,
        mixedTxs: 0,
        shieldedTxs: 0,
        byPool: { ironwood: 0, orchard: 0, sapling: 0, sprout: 0 },
      },
      totalFeeZat: 0,
      fundingStreams: [{ address: "t3stream", valueZat: 25_000_000 }],
      blockRewardZat: 156_250_000,
    };
    const detail = (await (
      await appWith({ getBlock: async () => transparent as never }).request("/v1/blocks/100")
    ).json()) as Record<string, unknown>;
    expect(detail.blockRewardZat).toBe(156_250_000);
    // Derived here so the model never subtracts: 156,250,000 − 25,000,000.
    expect(detail.minerRewardZat).toBe(131_250_000);
    expect(detail.fundingStreams).toEqual([{ address: "t3stream", valueZat: 25_000_000 }]);
    expect(detail.unknowns).toBeUndefined();

    /*
     * A ZIP-213 shielded coinbase pays a pool, so the amount is encrypted: the reason must be
     * `shielded` ("hidden by design"), never `unmeasured`, which would blame our own index.
     */
    const shielded = {
      ...transparent,
      miner: { kind: "shielded" as const },
      fundingStreams: [],
      blockRewardZat: null,
    };
    const veiled = (await (
      await appWith({ getBlock: async () => shielded as never }).request("/v1/blocks/100")
    ).json()) as Record<string, unknown>;
    expect(veiled.blockRewardZat).toBeNull();
    expect(veiled.minerRewardZat).toBeNull();
    const why = veiled.unknowns as Record<string, string>;
    expect(why.blockRewardZat).toBe("shielded");
    expect(why.minerRewardZat).toBe("shielded");
    // An empty stream list is a measurement (post-halving there are none), so it is still
    // emitted rather than folded into the nulls above.
    expect(veiled.fundingStreams).toEqual([]);
  });

  it("a shielded address answers 200 with an explanation and NO balance key", async () => {
    const res = await appWith().request(
      "/v1/addresses/zs1exampleshieldedsaplingaddressfixture0000000000000001",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.kind).toBe("sapling");
    expect(String(body.note)).toMatch(/encrypted on-chain/);
    // Not a null balance — NO key. A null would still imply a balance exists to look up.
    expect("balanceZat" in body).toBe(false);
  });

  it("/v1/transactions/{txid} carries rawHex only when explicitly asked", async () => {
    const app = appWith({ getTransaction: async () => ({ ...SPROUT_ONLY_TX, rawHex: "beef" }) });
    const bare = (await (await app.request("/v1/transactions/" + "a".repeat(64))).json()) as Record<
      string,
      unknown
    >;
    expect("rawHex" in bare).toBe(false);
    const raw = (await (
      await app.request("/v1/transactions/" + "a".repeat(64) + "?include=raw")
    ).json()) as Record<string, unknown>;
    expect(raw.rawHex).toBe("beef");
    const bad = await app.request("/v1/transactions/" + "a".repeat(64) + "?include=everything");
    expect(bad.status).toBe(400);
  });

  it("/v1/search resolves identifiers only, and a miss is null rather than 404", async () => {
    const res = await appWith().request("/v1/search?q=3428150");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { resolvesTo: unknown };
    // The fake port has no blocks, so a valid-shaped height resolves to nothing: an answer,
    // not an error.
    expect(body.resolvesTo).toBeNull();
  });

  it("404 stays distinct from 503 on block detail", async () => {
    const res = await appWith().request("/v1/blocks/999999");
    expect(res.status).toBe(404);
  });
});

describe("/v1/addresses/:addr rich-list standing", () => {
  const ADDR = "t1a7HnBdsBSvkGZQXD5vPYqoWRvnpG555Jy";
  const transparent = chainPort({
    getAddress: async () => ({
      kind: "transparent" as const,
      address: ADDR,
      balanceZat: 1_240_310_000,
      totalReceivedZat: 98_421_356_000,
      totalSentZat: 97_181_046_000,
      txids: [],
    }),
  });

  /**
   * A pool answering the standing query with one row's worth of columns. The all-address count
   * table answers only when given: absent, it has not started, which is the fallback's case.
   */
  const poolWith = (
    row: Record<string, unknown> | null,
    counts?: { state: Record<string, unknown>; tail: Record<string, unknown> },
  ) =>
    ({
      query: async (sql: string) => {
        if (sql.includes("address_tx_count_state")) return { rows: counts ? [counts.state] : [] };
        if (sql.includes("FROM tx_transparent_io")) return { rows: counts ? [counts.tail] : [] };
        return { rows: row === null ? [] : [row] };
      },
    }) as unknown as import("pg").Pool;

  const ask = async (pool?: import("pg").Pool) => {
    const app = v1Routes({
      chain: transparent,
      store: new MemoryStorePort(),
      enabledProtocols: {},
      ...(pool ? { pool } : {}),
      // First and last activity come from the index; answered here so these tests stay about
      // the rich-list standing.
      chainIndex: {
        addressActivityExtent: async () => ({
          first: { height: 100, timestamp: 1_500_000_000 },
          last: { height: 3_440_000, timestamp: 1_785_000_000 },
        }),
      } as unknown as import("../chain-index-store").ChainIndexStore,
    });
    const res = await app.request(`/v1/addresses/${ADDR}`);
    expect(res.status).toBe(200);
    return (await res.json()) as Record<string, unknown> & { unknowns?: Record<string, string> };
  };

  it("carries rank, txCount and the height they were computed at", async () => {
    const body = await ask(
      poolWith({ matched: ADDR, rank: "4127", tx_count: "812", computed_height: 3_447_900 }),
    );
    expect(body.rank).toBe(4127);
    expect(body.txCount).toBe(812);
    // The rich list's own height, not the tip the chain port reports.
    expect(body.rankAsOfHeight).toBe(3_447_900);
    expect(body.rankAsOfHeight).not.toBe(3_429_000);
    expect(body.unknowns).toBeUndefined();
  });

  /**
   * A zero-balance address is deleted from `chain_address_balance`, so no row is a measurement
   * (on no rich list), while an unreadable index is our own gap. Both arrive as `rank: null`,
   * and only the reason tells them apart.
   */
  it("says nonexistent for an address that holds nothing, and unmeasured for an outage", async () => {
    const spentOut = await ask(
      poolWith({ matched: null, rank: null, tx_count: null, computed_height: 3_447_900 }),
    );
    expect(spentOut.rank).toBeNull();
    expect(spentOut.unknowns?.rank).toBe("nonexistent");

    const noIndex = await ask();
    expect(noIndex.rank).toBeNull();
    expect(noIndex.unknowns?.rank).toBe("unmeasured");
    expect(noIndex.unknowns?.txCount).toBe("unmeasured");
    // The supplementary read failing must not fail the lookup: the balance still answers.
    expect(noIndex.balanceZat).toBe(1_240_310_000);
    expect(noIndex.rankAsOfHeight).toBeNull();
  });

  /**
   * An address that has spent everything is on no rich list, yet its count is still known: the
   * stored count through the watermark plus the blocks above it, read live.
   */
  it("counts an emptied address's transactions, through the newest block", async () => {
    const body = await ask(
      poolWith(
        { matched: null, rank: null, tx_count: null, computed_height: 3_447_900 },
        {
          state: {
            applied: 3_447_800,
            tip: 3_447_900,
            tx_count: 52_000,
            first_height: 1_046_400,
            last_height: 3_447_700,
          },
          tail: { n: 3, lo: 3_447_850, hi: 3_447_890 },
        },
      ),
    );
    expect(body.txCount).toBe(52_003);
    expect(body.unknowns?.txCount).toBeUndefined();
    // Still on no rich list, which is an answer.
    expect(body.unknowns?.rank).toBe("nonexistent");
  });

  /**
   * `rank` defaults to 0 until the hourly ranking pass numbers the row; publishing it would
   * report an unranked address as the largest holder.
   */
  it("never publishes a rank of 0, which means not yet ranked", async () => {
    const body = await ask(
      poolWith({ matched: ADDR, rank: "0", tx_count: null, computed_height: 3_447_900 }),
    );
    expect(body.rank).toBeNull();
    expect(body.unknowns?.rank).toBe("unmeasured");
    expect(body.unknowns?.txCount).toBe("unmeasured");
  });

  it("keeps the shielded refusal free of every one of these keys", async () => {
    const app = v1Routes({
      chain: transparent,
      store: new MemoryStorePort(),
      enabledProtocols: {},
      pool: poolWith({ matched: ADDR, rank: "1", tx_count: "9", computed_height: 3_447_900 }),
    });
    const res = await app.request(
      "/v1/addresses/zs1exampleshieldedsaplingaddressfixture0000000000000001",
    );
    const body = (await res.json()) as Record<string, unknown>;
    // A rank would imply a balance exists to rank, which the no-balance-key rule avoids.
    for (const key of ["rank", "txCount", "rankAsOfHeight", "balanceZat"]) {
      expect(key in body).toBe(false);
    }
  });
});

describe("/v1/transactions", () => {
  // A fake index: the contract under test is the route's, not SQL's.
  const fakeIndex = {
    listChainTransactions: async () => ({
      items: [SPROUT_ONLY_TX],
      nextCursor: "abc",
      prevCursor: null,
    }),
  } as unknown as import("../chain-index-store").ChainIndexStore;

  it("answers 503 without the index — never the capped node walk", async () => {
    const res = await appWith().request("/v1/transactions");
    expect(res.status).toBe(503);
  });

  it("rejects an unknown kind rather than widening it to all", async () => {
    const app = v1Routes({
      chain: chainPort({}),
      store: new MemoryStorePort(),
      enabledProtocols: {},
      chainIndex: fakeIndex,
    });
    const res = await app.request("/v1/transactions?kind=private");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("invalid_parameter");
  });

  /**
   * Asserts the value is forwarded to the store, not merely accepted: a route that validates
   * `?kind=shielding` and then drops it would answer 200 with every transaction on the chain.
   */
  it.each(["shielding", "unshielding"] as const)(
    "accepts kind=%s and passes it through to the index",
    async (kind) => {
      const seen: string[] = [];
      const recordingIndex = {
        listChainTransactions: async (k: string) => {
          seen.push(k);
          return { items: [SPROUT_ONLY_TX], nextCursor: null, prevCursor: null };
        },
      } as unknown as import("../chain-index-store").ChainIndexStore;
      const app = v1Routes({
        chain: chainPort({}),
        store: new MemoryStorePort(),
        enabledProtocols: {},
        chainIndex: recordingIndex,
      });
      const res = await app.request(`/v1/transactions?kind=${kind}`);
      expect(res.status).toBe(200);
      expect(seen).toEqual([kind]);
    },
  );

  it("emits nullable feeZat WITH its reason, and no total", async () => {
    const app = v1Routes({
      chain: chainPort({}),
      store: new MemoryStorePort(),
      enabledProtocols: {},
      chainIndex: fakeIndex,
    });
    const res = await app.request("/v1/transactions?kind=shielded");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Record<string, unknown>[];
      nextCursor: string | null;
      total?: unknown;
    };
    expect(body.total).toBeUndefined();
    expect(body.nextCursor).toBe("abc");
    const row = body.items[0]!;
    // The nullable key is present (the public layer never omits), with its reason beside it:
    // a Sprout-only fixture with no fee is indeterminate, not zero.
    expect("feeZat" in row).toBe(true);
    if (row.feeZat === null) {
      expect((row.unknowns as Record<string, string>).feeZat).toBeDefined();
    }
    expect(row.pools).toBeDefined();
  });

  it("400s an unknown query parameter — the anti-cache-bust rule", async () => {
    const app = v1Routes({
      chain: chainPort({}),
      store: new MemoryStorePort(),
      enabledProtocols: {},
      chainIndex: fakeIndex,
    });
    const res = await app.request("/v1/transactions?cachebust=1");
    expect(res.status).toBe(400);
  });

  /*
   * `direction` is a published enum, so its values are pinned at the HTTP boundary: `dto.ts`
   * owns its own literal union and never imports the domain, so a domain rename would not be
   * caught by the compiler here.
   */
  it("publishes direction in the protocol's verbs, never arrow notation", async () => {
    const t = { address: "t1Somebody", valueZat: 100_000_000 };
    const orchard = { actions: 2, valueBalanceZat: -10_000 };
    const cases: [Partial<Transaction>, string | null][] = [
      [{ sprout: { joinSplits: 2 } }, "shielded"],
      [{ orchard: { actions: 2, valueBalanceZat: 100_000_000 } }, "shielded"],
      [
        { transparentInputs: [t], orchard: { actions: 2, valueBalanceZat: 99_990_000 } },
        "shielding",
      ],
      [{ transparentOutputs: [t], orchard }, "unshielding"],
      [{ transparentInputs: [t], transparentOutputs: [t] }, null],
      [{ isCoinbase: true, transparentOutputs: [t] }, null],
    ];

    for (const [overrides, expected] of cases) {
      const tx: Transaction = {
        ...SPROUT_ONLY_TX,
        sprout: null,
        transparentInputs: [],
        transparentOutputs: [],
        ...overrides,
      };
      const app = v1Routes({
        chain: chainPort({}),
        store: new MemoryStorePort(),
        enabledProtocols: {},
        chainIndex: {
          listChainTransactions: async () => ({ items: [tx], nextCursor: null, prevCursor: null }),
        } as unknown as import("../chain-index-store").ChainIndexStore,
      });
      const body = (await (await app.request("/v1/transactions")).json()) as {
        items: Record<string, unknown>[];
      };
      const row = body.items[0]!;
      // Always emitted, even when null — the public layer never omits a nullable key.
      expect("direction" in row).toBe(true);
      expect(row.direction).toBe(expected);
    }
  });
});

describe("the wire contract stays decoupled from the domain", () => {
  it("dto.ts imports nothing at all", () => {
    // The public shapes must not be the domain shapes, so a domain rename can never become a
    // breaking API change by re-export. Enforced on the source text because the module graph
    // cannot express "does not depend on".
    const source = readFileSync("server/v1/dto.ts", "utf8");
    expect(source).not.toMatch(/^\s*import /m);
  });
});

describe("cross-cutting HTTP behaviour", () => {
  it("rejects an unknown query parameter with the envelope, never ignores it", async () => {
    // `?cachebust=<random>` would walk past every cache layer onto the node; also catches
    // `?diretcion=` typos that would silently return unfiltered data.
    const res = await appWith().request("/v1/supply?cachebust=123");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("unknown_parameter");
    expect(body.error.message).toContain("cachebust");
    expect(body.requestId).toBeTruthy();
  });

  it("carries Cache-Control on every success", async () => {
    for (const path of ["/v1", "/v1/status", "/v1/supply", "/v1/mempool/summary"]) {
      const res = await appWith().request(path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("cache-control"), path).toBeTruthy();
      expect(res.headers.get("etag"), path).toBeTruthy();
    }
  });

  it("answers OPTIONS for CORS preflight and refuses writes", async () => {
    const preflight = await appWith().request("/v1/supply", { method: "OPTIONS" });
    expect(preflight.status).toBeLessThan(300);

    const post = await appWith().request("/v1/supply", { method: "POST" });
    expect(post.status).toBe(405);
    expect((await post.json()).error.code).toBe("method_not_allowed");
  });

  it("unknown endpoints get the envelope, pointing at the descriptor", async () => {
    const res = await appWith().request("/v1/nope");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("not_found");
    expect(body.error.message).toContain("/v1");
  });

  it("a missing backing source is 503 upstream_unavailable, never 404", async () => {
    // Outage is not absence: a consumer must be able to tell "does not exist" from "cannot
    // answer right now".
    const app = v1Routes({
      store: new MemoryStorePort(),
      enabledProtocols: {},
    });
    for (const path of ["/v1/status", "/v1/supply", "/v1/reorgs/summary"]) {
      const res = await app.request(path);
      expect(res.status, path).toBe(503);
      expect((await res.json()).error.code, path).toBe("upstream_unavailable");
    }
  });
});

describe("GET /v1/status", () => {
  it("always emits the nullable keys, with reasons, when trackers are cold", async () => {
    const res = await appWith().request("/v1/status");
    const body = await res.json();
    // Cold trackers: the keys are emitted as null, never omitted.
    expect(body).toHaveProperty("priceUsd", null);
    expect(body).toHaveProperty("txCount24h", null);
    expect(body.unknowns).toMatchObject({
      priceUsd: "unmeasured",
      txCount24h: "unmeasured",
    });
  });
});

describe("GET /v1/supply", () => {
  it("states the partition, the lockbox as unspendable, and shares with denominators", async () => {
    const res = await appWith().request("/v1/supply");
    const body = await res.json();
    expect(body.partitionComplete).toBe(true);
    expect(body.shieldedZatExcludes).toContain("lockbox");

    const lockbox = body.pools.find((p: { pool: string }) => p.pool === "lockbox");
    expect(lockbox.spendable).toBe(false);
    expect(lockbox.shielded).toBe(false);
    expect(lockbox.shareOfShielded).toBeNull();

    const sapling = body.pools.find((p: { pool: string }) => p.pool === "sapling");
    expect(sapling.shareOfShielded).toMatchObject({
      numerator: 5_900_000_000_000,
      denominator: body.shieldedZat,
    });
    expect(body.minedZat + body.unminedZat).toBe(body.maxSupplyZat);
  });
});

describe("GET /v1/transactions/{txid}/privacy", () => {
  it("rejects a malformed txid before touching the node", async () => {
    const res = await appWith().request("/v1/transactions/tooshort/privacy");
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_parameter");
  });

  it("404s a well-formed absent txid with the envelope", async () => {
    const res = await appWith().request(`/v1/transactions/${"9".repeat(64)}/privacy`);
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });

  /**
   * Sprout is shielded but publishes no per-bundle balance, so a net figure would be invented.
   *
   * The reason is `unmeasured`, not `shielded`: Sprout's public values exist per JoinSplit
   * (`vpub_old`/`vpub_new`), but `SproutBundle` carries no value, so the figure never reaches the
   * mapper. That is our gap, not a privacy property of Zcash.
   */
  it("a Sprout-only transaction gets null net flow WITH its reason, never a zero", async () => {
    const app = appWith({ getTransaction: async () => SPROUT_ONLY_TX });
    const res = await app.request(`/v1/transactions/${"ab".repeat(32)}/privacy`);
    const body = await res.json();
    expect(body.kind).toBe("shielded");
    expect(body.netShieldedZat).toBeNull();
    expect(body.unknowns.netShieldedZat).toBe("unmeasured");
    expect(body.notKnowable).toContain("payment-vs-change-split");
    expect(body.bundles.sprout).toEqual({ joinSplits: 2 });
  });

  it("maps upstream failures to 503, not 404 and not a naked 500", async () => {
    const app = appWith({
      getTransaction: async () => {
        throw new Error("fetch failed: ECONNREFUSED 172.19.0.2:8232");
      },
    });
    const res = await app.request(`/v1/transactions/${"ab".repeat(32)}/privacy`);
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("upstream_unavailable");
  });
});

describe("GET /v1/crosschain/transfers", () => {
  it("nulls a placeholder ticker with a reason instead of shipping it as an asset", async () => {
    const store = new MemoryStorePort();
    await store.upsert([
      {
        id: "near-intents-x1",
        direction: "in",
        protocol: "near-intents",
        counterpartChain: "SOL",
        counterpartAsset: "SOL asset", // the parser's placeholder, not a ticker
        counterpartAmount: 9211.6,
        counterpartIsSynthetic: false,
        counterpartTxHash: null,
        counterpartAddress: null,
        zcashTxid: null,
        zcashAddress: null,
        zecAmountZat: 100_000_000,
        usdValueAtSwap: null,
        counterpartUsdAtSwap: null,
        venueDepositAddress: null,
        status: "completed",
        timestamp: 1_785_000_000,
      },
    ]);
    const app = v1Routes({ store, enabledProtocols: { "near-intents": true } });
    const res = await app.request("/v1/crosschain/transfers");
    const body = await res.json();

    const item = body.items[0];
    expect(item.legs.counterpart.asset).toBeNull();
    expect(item.unknowns["legs.counterpart.asset"]).toBe("unmeasured");
    // No top-level usdValue: the legs' figures differ by the venue's fee, never averaged.
    expect(item).not.toHaveProperty("usdValue");
    expect(body.coverage.basis).toBe("floor");
  });

  it("rejects an invalid filter value rather than silently widening to all", async () => {
    const res = await appWith().request("/v1/crosschain/transfers?direction=sideways");
    expect(res.status).toBe(400);
  });
});

/**
 * The narrowings the public transfer reads accept, and the ranking that needs them: the window
 * excludes its upper edge, an impossible date is refused rather than rolled over into another
 * month, and ranking by dollars states that it dropped every unpriced transfer.
 */
describe("narrowed cross-chain reads", () => {
  const at = (iso: string) => Math.floor(Date.parse(iso) / 1000);
  const base = {
    protocol: "maya" as const,
    counterpartAsset: "BTC",
    counterpartAmount: 1,
    counterpartIsSynthetic: false,
    counterpartTxHash: null,
    counterpartAddress: null,
    zcashTxid: null,
    zcashAddress: null,
    counterpartUsdAtSwap: null,
    venueDepositAddress: null,
    status: "completed" as const,
  };

  const storeWith = async () => {
    const store = new MemoryStorePort();
    await store.upsert([
      {
        ...base,
        id: "x-june",
        direction: "in",
        counterpartChain: "BTC",
        zecAmountZat: 100,
        usdValueAtSwap: 10,
        timestamp: at("2026-06-30T23:59:59Z"),
      },
      {
        ...base,
        id: "x-july-btc",
        direction: "in",
        counterpartChain: "BTC",
        zecAmountZat: 900,
        usdValueAtSwap: 20,
        timestamp: at("2026-07-15T00:00:00Z"),
      },
      {
        ...base,
        id: "x-july-eth",
        direction: "out",
        counterpartChain: "ETH",
        zecAmountZat: 5_000,
        // No published price, so it can be ranked by ZEC and must NOT appear in a USD ranking.
        usdValueAtSwap: null,
        timestamp: at("2026-07-16T00:00:00Z"),
      },
      {
        ...base,
        id: "x-august",
        direction: "in",
        counterpartChain: "BTC",
        zecAmountZat: 7_000,
        usdValueAtSwap: 9_000,
        timestamp: at("2026-08-01T00:00:00Z"),
      },
    ]);
    return v1Routes({ store, enabledProtocols: { maya: true } });
  };

  it("narrows the list to one chain and one month, upper edge EXCLUDED", async () => {
    const app = await storeWith();
    const body = await (
      await app.request("/v1/crosschain/transfers?chain=BTC&from=2026-07-01&to=2026-08-01")
    ).json();
    // x-june is before the window, x-august sits exactly on the exclusive upper edge, and
    // x-july-eth is a different chain. A closed range would return the August row too.
    expect(body.items.map((t: { id: string }) => t.id)).toEqual(["x-july-btc"]);
  });

  it("refuses a well-formed impossible day instead of rolling it into another month", async () => {
    // `Date.parse("2026-02-31")` succeeds and lands on 2026-03-03, so a shape check alone
    // would answer a question about February with a window in March.
    const app = await storeWith();
    expect((await app.request("/v1/crosschain/transfers?from=2026-02-31")).status).toBe(400);
    expect((await app.request("/v1/crosschain/transfers?from=nonsense")).status).toBe(400);
  });

  it("refuses a window that ends before it starts", async () => {
    const app = await storeWith();
    const res = await app.request("/v1/crosschain/transfers?from=2026-08-01&to=2026-07-01");
    expect(res.status).toBe(400);
  });

  it("ranks by ZEC, including transfers no venue priced", async () => {
    const app = await storeWith();
    const body = await (await app.request("/v1/crosschain/transfers/top?limit=2")).json();
    expect(body.items.map((t: { id: string }) => t.id)).toEqual(["x-august", "x-july-eth"]);
    expect(body.by).toBe("zec");
    expect(body.basisExcludesUnpricedTransfers).toBe(false);
  });

  it("ranks by dollars and SAYS that it dropped the unpriced transfers", async () => {
    // Ranking on the venues' price narrows the population; the flag makes that visible.
    const app = await storeWith();
    const body = await (await app.request("/v1/crosschain/transfers/top?by=usd")).json();
    expect(body.basisExcludesUnpricedTransfers).toBe(true);
    expect(body.items.map((t: { id: string }) => t.id)).not.toContain("x-july-eth");
    expect(body.items[0].id).toBe("x-august");
  });

  it("ranks from the smallest end and ECHOES which end it answered", async () => {
    const app = await storeWith();
    const largest = await (await app.request("/v1/crosschain/transfers/top?limit=2")).json();
    const smallest = await (
      await app.request("/v1/crosschain/transfers/top?limit=2&order=smallest")
    ).json();
    // The echo stops a consumer describing the smallest crossings as the largest; an older
    // deployment omits `order`, which is how a caller learns it was ignored.
    expect(largest.order).toBe("largest");
    expect(smallest.order).toBe("smallest");
    expect(smallest.items[0].id).not.toBe(largest.items[0].id);
  });

  it("rejects an unknown order rather than silently ranking the other way", async () => {
    const app = await storeWith();
    const res = await app.request("/v1/crosschain/transfers/top?order=biggest");
    expect(res.status).toBe(400);
  });

  it("keeps `top` out of the id route rather than 404ing on it", async () => {
    // Hono matches in declaration order, so `/transfers/top` is only a ranking because it is
    // declared before `/transfers/:id`. Reordering them turns it into a lookup for a transfer
    // whose id is the word "top".
    const app = await storeWith();
    expect((await app.request("/v1/crosschain/transfers/top")).status).toBe(200);
  });

  it("applies the same narrowing vocabulary to the ranking as to the list", async () => {
    const app = await storeWith();
    const body = await (
      await app.request("/v1/crosschain/transfers/top?chain=BTC&from=2026-07-01&to=2026-08-01")
    ).json();
    expect(body.items.map((t: { id: string }) => t.id)).toEqual(["x-july-btc"]);
  });

  it("rejects an unknown parameter on the ranking too", async () => {
    const app = await storeWith();
    expect((await app.request("/v1/crosschain/transfers/top?sort=biggest")).status).toBe(400);
    expect((await app.request("/v1/crosschain/transfers/top?by=vibes")).status).toBe(400);
  });
});

describe("GET /v1/crosschain/destinations", () => {
  it("keeps the unclassified bucket and computes the share over classified only", async () => {
    const store = new MemoryStorePort();
    const base = {
      direction: "in" as const,
      protocol: "maya" as const,
      counterpartChain: "BTC",
      counterpartAsset: "BTC",
      counterpartAmount: 1,
      counterpartIsSynthetic: false,
      counterpartTxHash: null,
      counterpartAddress: null,
      zcashTxid: null,
      zecAmountZat: 100_000_000,
      usdValueAtSwap: null,
      counterpartUsdAtSwap: null,
      venueDepositAddress: null,
      status: "completed" as const,
      timestamp: 1_785_000_000,
    };
    await store.upsert([
      { ...base, id: "m-1", zcashAddress: "t1XWk29dAliceFixtureAddr000001" },
      {
        ...base,
        id: "m-2",
        zcashAddress: "zs1exampleshieldedsaplingaddressfixture0000000000000001",
      },
      { ...base, id: "m-3", zcashAddress: null }, // venue published no address
    ]);
    const app = v1Routes({ store, enabledProtocols: { maya: true } });
    const body = await (await app.request("/v1/crosschain/destinations?direction=in")).json();

    const nullBucket = body.buckets.find(
      (b: { addressKind: string | null }) => b.addressKind === null,
    );
    expect(nullBucket, "the unclassified bucket must exist").toBeTruthy();
    expect(nullBucket.shieldedCapable).toBeNull();

    // 1 shielded-capable of 2 classified — the null row is excluded from BOTH sides.
    expect(body.shieldedCapableShare).toMatchObject({ numerator: 1, denominator: 2 });
    expect(body.receiverUsedIsNotPublic).toBe(true);
  });

  /*
   * An ambiguous null carries a reason. Without one, a consumer's natural default
   * (`shieldedCapable ?? false`) would understate the shielded-capable share.
   */
  it("names a reason for the unclassified bucket's nulls", async () => {
    const store = new MemoryStorePort();
    const base = {
      direction: "in" as const,
      protocol: "maya" as const,
      counterpartChain: "BTC",
      counterpartAsset: "BTC",
      counterpartAmount: 1,
      counterpartIsSynthetic: false,
      counterpartTxHash: null,
      counterpartAddress: null,
      zcashTxid: null,
      zecAmountZat: 100_000_000,
      usdValueAtSwap: null,
      counterpartUsdAtSwap: null,
      venueDepositAddress: null,
      status: "completed" as const,
      timestamp: 1_785_000_000,
    };
    await store.upsert([
      { ...base, id: "u-1", zcashAddress: "t1XWk29dAliceFixtureAddr000001" },
      { ...base, id: "u-2", zcashAddress: null },
    ]);
    const app = v1Routes({ store, enabledProtocols: { maya: true } });
    const body = (await (await app.request("/v1/crosschain/destinations?direction=in")).json()) as {
      buckets: { addressKind: string | null }[];
      unknowns?: Record<string, string>;
    };

    const i = body.buckets.findIndex((b) => b.addressKind === null);
    expect(i, "the unclassified bucket must exist").toBeGreaterThanOrEqual(0);
    expect(body.unknowns?.[`buckets[${i}].addressKind`]).toBe("unmeasured");
    expect(body.unknowns?.[`buckets[${i}].shieldedCapable`]).toBe("unmeasured");
  });

  it("emits no unknowns when every bucket is classified", async () => {
    // `withUnknowns` attaches nothing when there is nothing to say, so the key's presence means
    // "something here is unknown".
    const store = new MemoryStorePort();
    await store.upsert([
      {
        id: "c-1",
        direction: "in" as const,
        protocol: "maya" as const,
        counterpartChain: "BTC",
        counterpartAsset: "BTC",
        counterpartAmount: 1,
        counterpartIsSynthetic: false,
        counterpartTxHash: null,
        counterpartAddress: null,
        zcashTxid: null,
        zcashAddress: "t1XWk29dAliceFixtureAddr000001",
        zecAmountZat: 100_000_000,
        usdValueAtSwap: null,
        counterpartUsdAtSwap: null,
        venueDepositAddress: null,
        status: "completed" as const,
        timestamp: 1_785_000_000,
      },
    ]);
    const app = v1Routes({ store, enabledProtocols: { maya: true } });
    const body = (await (
      await app.request("/v1/crosschain/destinations?direction=in")
    ).json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty("unknowns");
  });
});

describe("GET /v1/analytics/monthly", () => {
  const fakePool = {
    query: async () => ({
      rows: [
        // Two months; balances chosen so netFlow(second) = 40 zat.
        {
          ts: "1700000000",
          top_height: 100,
          transparent: 5,
          mixed: 3,
          shielded: 2,
          sprout: "10",
          sapling: "20",
          orchard: "30",
          ironwood: "0",
        },
        {
          ts: "1702600000",
          top_height: 200,
          transparent: 8,
          mixed: 1,
          shielded: 1,
          sprout: "10",
          sapling: "40",
          orchard: "40",
          ironwood: "10",
        },
      ],
    }),
  } as unknown as Pool;

  it("serves shares with denominators and range-filters in memory", async () => {
    const app = v1Routes({
      store: new MemoryStorePort(),
      pool: fakePool,
      enabledProtocols: {},
    });
    const all = await (await app.request("/v1/analytics/monthly")).json();
    expect(all.points).toHaveLength(2);
    expect(all.points[1].netFlowZat).toBe(40);
    expect(all.points[0].fullyShieldedShare).toMatchObject({ numerator: 2, denominator: 10 });

    // A range that keeps only the second month must still difference against the FIRST —
    // otherwise the first month of every range reports its whole balance as inflow.
    const ranged = await (await app.request("/v1/analytics/monthly?from=1702000000")).json();
    expect(ranged.points).toHaveLength(1);
    expect(ranged.points[0].netFlowZat).toBe(40);
  });

  it("rejects a non-numeric range", async () => {
    const app = v1Routes({ store: new MemoryStorePort(), pool: fakePool, enabledProtocols: {} });
    const res = await app.request("/v1/analytics/monthly?from=yesterday");
    expect(res.status).toBe(400);
  });
});

describe("/v1/supply/circulating", () => {
  it("serves a bare ZEC decimal as text by default — the aggregator contract", async () => {
    const app = appWith();
    const res = await app.request("/v1/supply/circulating");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    const text = await res.text();
    // mined = sum of all six pools; circulating excludes the lockbox.
    const mined =
      1_560_000_000_000_000 +
      2_994_923_783 +
      5_900_000_000_000 +
      36_000_000_000_000 +
      1_700_000_000_000 +
      800_000_000_000;
    const circulating = mined - 800_000_000_000;
    const [whole, frac] = text.split(".");
    expect(Number(whole) * 100_000_000 + Number(frac)).toBe(circulating);
    expect(frac).toHaveLength(8);
  });

  it("?format=json names the exclusion instead of implying it", async () => {
    const app = appWith();
    const res = await app.request("/v1/supply/circulating?format=json");
    const body = await res.json();
    expect(body.excludes).toEqual(["lockbox"]);
    expect(body.circulatingZat + 800_000_000_000).toBe(
      1_560_000_000_000_000 +
        2_994_923_783 +
        5_900_000_000_000 +
        36_000_000_000_000 +
        1_700_000_000_000 +
        800_000_000_000,
    );
    expect(body.heightReadAt).toBe(3_429_000);
  });

  it("rejects unknown params like every other endpoint", async () => {
    const app = appWith();
    const res = await app.request("/v1/supply/circulating?cachebust=1");
    expect(res.status).toBe(400);
  });
});

describe("/v1/network/fees", () => {
  it("states the ZIP-317 convention with the verified migration example", async () => {
    const app = appWith();
    const res = await app.request("/v1/network/fees");
    const body = await res.json();
    expect(body.marginalFeeZat).toBe(5000);
    expect(body.graceActions).toBe(2);
    for (const example of body.examples) {
      // Every example must satisfy the formula it sits beside.
      expect(example.conventionalFeeZat).toBe(5000 * Math.max(2, example.logicalActions));
    }
  });
});

describe("a wide transaction never takes the node walk when the index has it", () => {
  /**
   * `/privacy` and `include=raw` read the index; the node is asked only for the hex. Resolving
   * every input through the node holds all source transactions in memory at once, which a wide
   * transaction turns into an out-of-memory crash.
   */
  const indexedWide = { ...SPROUT_ONLY_TX, txid: "c8".repeat(32) };
  const nodeWalk = async (): Promise<never> => {
    throw new Error("the node walk must not run for an indexed transaction");
  };
  const app = () =>
    v1Routes({
      chain: chainPort({
        getTransaction: nodeWalk,
        getRawTransactionHex: async () => "deadbeef",
      }),
      store: new MemoryStorePort(),
      enabledProtocols: { maya: true },
      chainIndex: {
        getTransaction: async () => indexedWide,
      } as unknown as import("../chain-index-store").ChainIndexStore,
    });

  it("/privacy is served from the index", async () => {
    const res = await app().request(`/v1/transactions/${indexedWide.txid}/privacy`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.txid).toBe(indexedWide.txid);
  });

  it("include=raw is the indexed transaction plus the node's hex, nothing resolved", async () => {
    const res = await app().request(`/v1/transactions/${indexedWide.txid}?include=raw`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rawHex).toBe("deadbeef");
    expect(body.txid).toBe(indexedWide.txid);
  });

  it("include=raw draws on one byte budget for every caller, and a spent one costs the node nothing", async () => {
    const hexCalls: string[] = [];
    const budgeted = v1Routes({
      chain: chainPort({
        getTransaction: nodeWalk,
        getRawTransactionHex: async (txid: string) => {
          hexCalls.push(txid);
          return "deadbeef";
        },
      }),
      store: new MemoryStorePort(),
      enabledProtocols: { maya: true },
      chainIndex: {
        getTransaction: async () => indexedWide,
      } as unknown as import("../chain-index-store").ChainIndexStore,
      // Exactly one answer's worth: the hex is twice the serialised size.
      rawHexBudget: new ByteBudget(indexedWide.sizeBytes * 2, 1),
    });
    const url = `/v1/transactions/${indexedWide.txid}`;
    expect((await budgeted.request(`${url}?include=raw`)).status).toBe(200);
    const refused = await budgeted.request(`${url}?include=raw`);
    expect(refused.status).toBe(503);
    expect(Number(refused.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect((await refused.json()).error.code).toBe("upstream_unavailable");
    expect(hexCalls).toHaveLength(1);
    // The budget prices bytes, not lookups: the same transaction without its hex still answers.
    expect((await budgeted.request(url)).status).toBe(200);
  });

  it("include=raw on the node path (a mempool transaction) is charged once the node answers", async () => {
    const mempool = { ...indexedWide, blockHeight: null, rawHex: "ab".repeat(300) };
    const budgeted = v1Routes({
      chain: chainPort({ getTransaction: async () => mempool }),
      store: new MemoryStorePort(),
      enabledProtocols: { maya: true },
      chainIndex: {
        getTransaction: async () => undefined,
      } as unknown as import("../chain-index-store").ChainIndexStore,
      rawHexBudget: new ByteBudget(1_000, 1),
    });
    const url = `/v1/transactions/${indexedWide.txid}?include=raw`;
    expect((await budgeted.request(url)).status).toBe(200);
    // 400 bytes left of 1,000, 600 asked: 200 more at one byte a second.
    const refused = await budgeted.request(url);
    expect(refused.status).toBe(503);
    expect(refused.headers.get("Retry-After")).toBe("200");
  });

  it("falls back to the node for a transaction the index does not hold (mempool)", async () => {
    const mempool = { ...indexedWide, blockHeight: null };
    const fallback = v1Routes({
      chain: chainPort({ getTransaction: async () => mempool }),
      store: new MemoryStorePort(),
      enabledProtocols: { maya: true },
      chainIndex: {
        getTransaction: async () => undefined,
      } as unknown as import("../chain-index-store").ChainIndexStore,
    });
    const res = await fallback.request(`/v1/transactions/${indexedWide.txid}/privacy`);
    expect(res.status).toBe(200);
  });
});

describe("/v1/network/halving", () => {
  /**
   * Every subsidy change so far plus the next one. Blossom is in the list and labelled as not a
   * halving; the last entry is the next halving and is unmined, so its `at` is null.
   */
  it("lists every past subsidy change and the next halving, oldest first", async () => {
    const app = appWith();
    const body = await (await app.request("/v1/network/halving")).json();
    const kinds = body.events.map((e: { kind: string; height: number }) => [e.kind, e.height]);
    expect(kinds).toEqual([
      ["block-time-change", 653_600],
      ["halving", 1_046_400],
      ["halving", 2_726_400],
      ["halving", 4_406_400],
    ]);
    const last = body.events.at(-1);
    expect(last.height).toBe(body.halvingHeight);
    expect(last.at).toBeNull();
    expect(last.atUtc).toBeNull();
    // The split at the boundary is the node's, both sides.
    expect(last.before.totalZat).toBe(156_250_000);
    expect(last.after.totalZat).toBe(78_125_000);
    for (const e of body.events) {
      for (const s of [e.before, e.after]) {
        expect(s.minerZat + s.fundingStreamsZat + s.lockboxZat).toBe(s.totalZat);
      }
    }
  });

  it("countdown is arithmetic off the tip; subsidies come from the node", async () => {
    const app = appWith();
    const res = await app.request("/v1/network/halving");
    const body = await res.json();
    expect(body.halvingHeight).toBe(4_406_400);
    expect(body.blocksRemaining).toBe(4_406_400 - 3_429_000);
    expect(body.estimatedSecondsRemaining).toBe(body.blocksRemaining * 75);
    // Node ZEC floats become exact zatoshis.
    expect(body.currentSubsidy.totalZat).toBe(156_250_000);
    expect(body.currentSubsidy.minerZat).toBe(125_000_000);
    expect(body.currentSubsidy.lockboxZat).toBe(18_750_000);
    expect(body.nextSubsidy.totalZat).toBe(78_125_000);
    // The subsidy partition must add up: miner + streams + lockbox = total.
    for (const s of [body.currentSubsidy, body.nextSubsidy]) {
      expect(s.minerZat + s.fundingStreamsZat + s.lockboxZat).toBe(s.totalZat);
    }
  });

  /**
   * The share fields, asserted at the HTTP boundary: a consumer that does not divide could not
   * answer "what share goes to funding streams" from the zatoshi figures alone.
   */
  it("splits the subsidy as percentages carrying both their terms", async () => {
    const app = appWith();
    const body = await (await app.request("/v1/network/halving")).json();

    expect(body.currentSubsidy.minerShare).toEqual({
      pct: 80,
      numerator: 125_000_000,
      denominator: 156_250_000,
    });
    expect(body.currentSubsidy.fundingStreamsShare.pct).toBe(8);
    expect(body.currentSubsidy.lockboxShare.pct).toBe(12);

    // The shares partition the subsidy exactly, for the same reason the zatoshi figures must.
    for (const s of [body.currentSubsidy, body.nextSubsidy]) {
      const total = s.minerShare.pct + s.fundingStreamsShare.pct + s.lockboxShare.pct;
      expect(total).toBe(100);
      for (const share of [s.minerShare, s.fundingStreamsShare, s.lockboxShare]) {
        expect(share.denominator).toBe(s.totalZat);
      }
    }

    // Past the halving ZIP 214 revision 2's streams have ended, so the miner has all of it.
    // A zero share is emitted, never omitted: 0% here is a measurement.
    expect(body.nextSubsidy.minerShare.pct).toBe(100);
    expect(body.nextSubsidy.fundingStreamsShare).toEqual({
      pct: 0,
      numerator: 0,
      denominator: 78_125_000,
    });
  });

  it("names each stream, its own share, and the ZIP that defines it", async () => {
    const app = appWith();
    const body = await (await app.request("/v1/network/halving")).json();

    expect(body.currentSubsidy.fundingStreams).toHaveLength(1);
    const [fs] = body.currentSubsidy.fundingStreams;
    // The node's OWN label, passed through — see V1SubsidyStream. It lags the ZIP's recipient
    // name, and correcting it here would assert a mapping consensus does not publish.
    expect(fs.recipient).toBe("Major Grants");
    expect(fs.specification).toBe("https://zips.z.cash/zip-0214");
    expect(fs.valueZat).toBe(12_500_000);
    expect(fs.address).toBe("t3cFfPt1Bcvgez9ZbMBFWeZsskxTkPzGCow");
    expect(fs.share.pct).toBe(8);

    // A lockbox stream is paid into a pool, so it has no address — null, never "" or absent.
    const [lb] = body.currentSubsidy.lockboxStreams;
    expect(lb.address).toBeNull();
    expect(lb.share.pct).toBe(12);

    // Every stream's own share sums back to the aggregate share for its kind, so a reader can
    // check the parts against the whole rather than taking the total on trust.
    const streamed = body.currentSubsidy.fundingStreams.reduce(
      (n: number, s: { valueZat: number }) => n + s.valueZat,
      0,
    );
    expect(streamed).toBe(body.currentSubsidy.fundingStreamsZat);
  });

  it("reports no streams past the halving as an empty list, not a missing key", async () => {
    const app = appWith();
    const body = await (await app.request("/v1/network/halving")).json();
    // Absent arrays from the node mean no stream is ACTIVE at that height, which is a
    // measurement — so they surface as [] and carry no `unknowns` reason. Omitting the keys
    // would leave a consumer unable to tell "none active" from "this API does not say".
    expect(body.nextSubsidy.fundingStreams).toEqual([]);
    expect(body.nextSubsidy.lockboxStreams).toEqual([]);
  });

  it("is a 503 when the chain source is absent, never a 404", async () => {
    const app = v1Routes({
      store: new MemoryStorePort(),
      enabledProtocols: { maya: true },
    });
    const res = await app.request("/v1/network/halving");
    expect(res.status).toBe(503);
  });
});

describe("the descriptor's refusals", () => {
  it("refuses linkability by name, with the aggregate alternative stated", async () => {
    const app = appWith();
    const body = await (await app.request("/v1")).json();
    const paths = body.refused.map((r: { path: string }) => r.path);
    expect(paths.some((p: string) => p.includes("linkability"))).toBe(true);
    expect(paths.some((p: string) => p.includes("broadcast"))).toBe(true);
    // Address labels are not a published refusal; the assertion guards against one quietly
    // returning to the descriptor.
    expect(paths.some((p: string) => p.includes("labels"))).toBe(false);
  });
});

describe("the descriptor's rate limits match the Caddyfile", () => {
  it("documents the numbers the box actually enforces", async () => {
    const caddyfile = readFileSync(join(__dirname, "..", "Caddyfile"), "utf8");
    const app = appWith();
    const body = await (await app.request("/v1")).json();
    const rl = body.rateLimit;
    // Each zone in the Caddyfile: events N ... window W. The descriptor must agree.
    const zone = (name: string) => {
      // Non-greedy across the block: `key {remote_host}` inside a zone contains a `}`.
      const m = caddyfile.match(
        new RegExp(`zone ${name} \\{.*?events (\\d+).*?window (\\S+)`, "s"),
      );
      if (!m) throw new Error(`zone ${name} not found in Caddyfile`);
      return { events: Number(m[1]), window: m[2] };
    };
    expect(rl.perIpBurst.events).toBe(zone("v1_burst").events);
    expect(zone("v1_burst").window).toBe("1s");
    expect(rl.perIpSustained.events).toBe(zone("v1_ip").events);
    expect(zone("v1_ip").window).toBe("1m");
    expect(rl.globalCeiling.events).toBe(zone("v1_global").events);
    expect(zone("v1_global").window).toBe("1m");
    const wa = rl.windowedAnalytics;
    expect(wa.perIpBurst.events).toBe(zone("v1_analytics_burst").events);
    expect(zone("v1_analytics_burst").window).toBe("1s");
    expect(wa.perIpSustained.events).toBe(zone("v1_analytics_ip").events);
    expect(zone("v1_analytics_ip").window).toBe("1m");
    expect(wa.globalCeiling.events).toBe(zone("v1_analytics_global").events);
    expect(zone("v1_analytics_global").window).toBe("1m");
    // The matcher must cover exactly the paths the descriptor says the zone applies to: a path
    // in one list and not the other is a limit published and not enforced, or the reverse.
    const matcher = caddyfile.match(/@v1_analytics path ([^\n]+)/);
    expect(matcher?.[1]?.trim().split(/\s+/).sort()).toEqual([...wa.appliesTo].sort());
    const aw = rl.addressWindows;
    expect(aw.perIpBurst.events).toBe(zone("v1_address_burst").events);
    expect(zone("v1_address_burst").window).toBe("1s");
    expect(aw.perIpSustained.events).toBe(zone("v1_address_ip").events);
    expect(zone("v1_address_ip").window).toBe("1m");
    expect(aw.globalCeiling.events).toBe(zone("v1_address_global").events);
    expect(zone("v1_address_global").window).toBe("1m");
    // The Caddy regexp and the app's own copy must be the same pattern, and it must match
    // exactly the two templated paths and nothing else under an address.
    const re = caddyfile.match(/@v1_address path_regexp (\S+)/)?.[1];
    expect(re).toBe(V1_ADDRESS_WINDOW_REGEXP);
    const rx = new RegExp(re!);
    for (const p of aw.appliesTo) expect(rx.test(p.replace("{address}", "t1abc"))).toBe(true);
    expect(rx.test("/v1/addresses/t1abc")).toBe(false);
    expect(rx.test("/v1/addresses/t1abc/transactions")).toBe(false);
    // The block list reads one block from the node per row, so it carries zones of its own.
    const bl = rl.blockList;
    expect(bl.perIpBurst.events).toBe(zone("v1_blocks_burst").events);
    expect(zone("v1_blocks_burst").window).toBe("1s");
    expect(bl.perIpSustained.events).toBe(zone("v1_blocks_ip").events);
    expect(zone("v1_blocks_ip").window).toBe("1m");
    expect(bl.globalCeiling.events).toBe(zone("v1_blocks_global").events);
    expect(zone("v1_blocks_global").window).toBe("1m");
    const blockMatcher = caddyfile.match(/@v1_block_list path ([^\n]+)/);
    expect(blockMatcher?.[1]?.trim().split(/\s+/).sort()).toEqual([...bl.appliesTo].sort());
    expect(rl.perDay).toBeNull();
  });

  /**
   * The third copy of these numbers: the rate limits live in `server/Caddyfile` (where they are
   * enforced), in this descriptor (pinned to the Caddyfile above), and in `API_RATE_LIMITS`, the
   * table `/api-docs` renders, which is the copy a developer actually reads.
   *
   * Parsed out of the prose rather than restated here, so a test cannot pass on a table that says
   * anything at all.
   */
  it("the /api-docs rate-limit table agrees with the descriptor it documents", async () => {
    const { API_RATE_LIMITS } = await import("@/api-catalogue");
    const body = (await (await appWith().request("/v1")).json()) as {
      rateLimit: Record<string, { events: number; windowSeconds: number } | null>;
    };
    const row = (scope: string) => {
      const found = API_RATE_LIMITS.find((r) => r.scope.toLowerCase() === scope);
      if (!found) throw new Error(`no /api-docs rate-limit row for "${scope}"`);
      return found;
    };
    const events = (scope: string) => Number(row(scope).limit.replace(/[^0-9]/g, ""));
    const seconds = (scope: string) => (/minute/i.test(row(scope).window) ? 60 : 1);

    for (const [scope, key] of [
      ["per ip, burst", "perIpBurst"],
      ["per ip, sustained", "perIpSustained"],
      ["global, all callers", "globalCeiling"],
    ] as const) {
      expect(events(scope), `${scope} events`).toBe(body.rateLimit[key]!.events);
      expect(seconds(scope), `${scope} window`).toBe(body.rateLimit[key]!.windowSeconds);
    }
    const wa = (
      body.rateLimit as unknown as Record<
        string,
        Record<string, { events: number; windowSeconds: number }>
      >
    ).windowedAnalytics!;
    for (const [scope, key] of [
      ["windowed analytics, per ip, burst", "perIpBurst"],
      ["windowed analytics, per ip, sustained", "perIpSustained"],
      ["windowed analytics, all callers", "globalCeiling"],
    ] as const) {
      expect(events(scope), `${scope} events`).toBe(wa[key]!.events);
      expect(seconds(scope), `${scope} window`).toBe(wa[key]!.windowSeconds);
    }
    const aw = (
      body.rateLimit as unknown as Record<
        string,
        Record<string, { events: number; windowSeconds: number }>
      >
    ).addressWindows!;
    for (const [scope, key] of [
      ["address windows, per ip, burst", "perIpBurst"],
      ["address windows, per ip, sustained", "perIpSustained"],
      ["address windows, all callers", "globalCeiling"],
    ] as const) {
      expect(events(scope), `${scope} events`).toBe(aw[key]!.events);
      expect(seconds(scope), `${scope} window`).toBe(aw[key]!.windowSeconds);
    }
    const bl = (
      body.rateLimit as unknown as Record<
        string,
        Record<string, { events: number; windowSeconds: number }>
      >
    ).blockList!;
    for (const [scope, key] of [
      ["block list, per ip, burst", "perIpBurst"],
      ["block list, per ip, sustained", "perIpSustained"],
      ["block list, all callers", "globalCeiling"],
    ] as const) {
      expect(events(scope), `${scope} events`).toBe(bl[key]!.events);
      expect(seconds(scope), `${scope} window`).toBe(bl[key]!.windowSeconds);
    }
    // `perDay: null` is a privacy decision (no per-caller accounting), so the docs table must keep
    // saying "none".
    expect(body.rateLimit.perDay).toBeNull();
    expect(row("per day").limit).toMatch(/none/i);
  });
});

describe("/v1/prices/daily", () => {
  /**
   * The all-time high and low ride on every page however narrow the range, so the record is
   * reachable despite the row cap. Asserted on a narrow page, where deriving them from `items`
   * would be wrong.
   */
  it("carries the whole series' all-time high and low on a narrow page", async () => {
    const days = ["2016-10-29", "2019-01-01", "2019-01-02", "2024-06-01"];
    const rows = days.map((day) => ({ day, usd: 100, source: "yahoo" }));
    rows[0]!.usd = 2239.29;
    rows[0]!.source = "coincodex";
    rows[2]!.usd = 24.5;
    const app = v1Routes({
      store: new MemoryStorePort(),
      enabledProtocols: { maya: true },
      pool: {
        query: async (sql: string, params: unknown[]) => {
          if (sql.includes("AS kind")) {
            const byUsd = [...rows].sort((a, b) => a.usd - b.usd);
            const asRow = (kind: string, r: (typeof rows)[number]) => ({
              kind,
              day: new Date(`${r.day}T00:00:00Z`),
              usd: r.usd,
              source: r.source,
            });
            return { rows: [asRow("high", byUsd.at(-1)!), asRow("low", byUsd[0]!)] };
          }
          if (sql.includes("min(day)")) {
            return {
              rows: [
                { from: new Date("2016-10-29T00:00:00Z"), to: new Date("2024-06-01T00:00:00Z") },
              ],
            };
          }
          const [from, to] = params as [string | null, string | null];
          return {
            rows: rows
              .filter((r) => (from === null || r.day >= from) && (to === null || r.day <= to))
              .map((r) => ({ day: new Date(`${r.day}T00:00:00Z`), usd: r.usd, source: r.source })),
          };
        },
      } as never,
    });
    const body = await (await app.request("/v1/prices/daily?from=2024-06-01")).json();
    expect(body.items).toHaveLength(1);
    expect(body.allTimeHigh).toEqual({ day: "2016-10-29", usd: 2239.29, source: "coincodex" });
    expect(body.allTimeLow).toEqual({ day: "2019-01-02", usd: 24.5, source: "yahoo" });
  });

  it("rejects a malformed date and unknown params", async () => {
    const app = appWith();
    expect((await app.request("/v1/prices/daily?from=yesterday")).status).toBe(400);
    expect((await app.request("/v1/prices/daily?limit=5")).status).toBe(400);
  });

  it("refuses a well-shaped day that does not exist before it reaches the database", async () => {
    let queries = 0;
    const app = v1Routes({
      store: new MemoryStorePort(),
      enabledProtocols: { maya: true },
      pool: { query: async () => (queries++, { rows: [] }) } as never,
    });
    for (const q of ["from=2026-02-31", "to=2026-13-01"]) {
      const res = await app.request(`/v1/prices/daily?${q}`);
      expect(res.status, q).toBe(400);
      expect((await res.json()).error.message, q).toBe("from/to must be YYYY-MM-DD");
    }
    expect(queries).toBe(0);
  });

  it("is a 503 without a store, never an empty list", async () => {
    // An outage must not read as "ZEC has no price history".
    const app = v1Routes({ store: new MemoryStorePort(), enabledProtocols: { maya: true } });
    const res = await app.request("/v1/prices/daily");
    expect(res.status).toBe(503);
  });

  /**
   * With no range given the cap takes the 1,000 newest rows, so `firstDay` is not the start of the
   * data and `truncated: true` cannot say how much more exists.
   *
   * The property: on a capped page the two pairs must disagree, and `availableFrom` must name the
   * real start. Asserting only that the keys exist would pass an implementation that set them
   * from the page.
   */
  const priceRow = (day: string) => ({ day, usd: 100, source: "yahoo" });
  const priceApp = (days: readonly string[]) => {
    const rows = days.map(priceRow);
    return v1Routes({
      store: new MemoryStorePort(),
      enabledProtocols: { maya: true },
      pool: {
        query: async (sql: string, params: unknown[]) => {
          if (sql.includes("AS kind")) {
            // The all-time extremes, over the WHOLE series regardless of the page asked for.
            const byUsd = [...rows].sort((a, b) => a.usd - b.usd || a.day.localeCompare(b.day));
            const asRow = (kind: string, r: { day: string; usd: number; source: string }) => ({
              kind,
              day: new Date(`${r.day}T00:00:00Z`),
              usd: r.usd,
              source: r.source,
            });
            return {
              rows:
                byUsd.length === 0 ? [] : [asRow("high", byUsd.at(-1)!), asRow("low", byUsd[0]!)],
            };
          }
          if (sql.includes("min(day)")) {
            const sorted = [...rows].map((r) => r.day).sort();
            return {
              rows: [
                {
                  from: new Date(`${sorted[0]}T00:00:00Z`),
                  to: new Date(`${sorted.at(-1)}T00:00:00Z`),
                },
              ],
            };
          }
          const [from, to, limit] = params as [string | null, string | null, number];
          const inRange = rows.filter(
            (r) => (from === null || r.day >= from) && (to === null || r.day <= to),
          );
          return {
            rows: inRange
              .slice(-limit)
              .map((r) => ({ day: new Date(`${r.day}T00:00:00Z`), usd: r.usd, source: r.source })),
          };
        },
      } as never,
    });
  };
  // 1,400 consecutive days ending well before "today", so the 1,000-row cap bites and the
  // oldest 400 fall outside the page — the shape the live table has.
  const START_MS = Date.parse("2019-01-01T00:00:00Z");
  const SERIES = Array.from({ length: 1_400 }, (_, i) =>
    new Date(START_MS + i * 86_400_000).toISOString().slice(0, 10),
  );

  it("names the whole series' extent, not the page's, when the page is capped", async () => {
    const res = await priceApp(SERIES).request("/v1/prices/daily");
    const body = (await res.json()) as Record<string, unknown>;

    expect(body.truncated).toBe(true);
    expect((body.items as unknown[]).length).toBe(1_000);
    // The page starts 1,000 rows from the end...
    expect(body.firstDay).toBe(SERIES[400]);
    // ...and the series starts 400 days earlier.
    expect(body.availableFrom).toBe(SERIES[0]);
    expect(body.availableFrom).not.toBe(body.firstDay);
    expect(body.availableTo).toBe(SERIES.at(-1));
  });

  it("still reports the series' extent when a narrow range is asked for", async () => {
    // The failure mode in the other direction: a caller paging to 2019 must not be told the
    // data ENDS in 2019. `?from=&to=` narrows the page and must not touch the bounds.
    const res = await priceApp(SERIES).request(
      `/v1/prices/daily?from=${SERIES[0]}&to=${SERIES[2]}`,
    );
    const body = (await res.json()) as Record<string, unknown>;

    expect((body.items as unknown[]).length).toBe(3);
    expect(body.lastDay).toBe(SERIES[2]);
    expect(body.availableTo).toBe(SERIES.at(-1));
    expect(body.truncated).toBe(false);
  });

  it("emits both bounds even when the page is empty, so a gap is not read as an empty store", async () => {
    // A day inside the series with no row, and a day outside it, are different answers. A
    // caller can only tell them apart if the bounds arrive on a page holding nothing.
    const res = await priceApp(SERIES).request("/v1/prices/daily?from=2050-01-01&to=2050-01-02");
    const body = (await res.json()) as Record<string, unknown>;

    expect(body.items).toEqual([]);
    expect(body.firstDay).toBeNull();
    expect(body.availableFrom).toBe(SERIES[0]);
    expect(body.availableTo).toBe(SERIES.at(-1));
  });
});

/**
 * The per-chain swap-time USD never travels without its coverage: a venue that published no
 * price contributes ZEC and no dollars, so the dollar total is a floor within a floor.
 */
describe("/v1/crosschain/flows carries swap-time USD with its coverage", () => {
  const transfer = (over: Record<string, unknown>) =>
    ({
      id: Math.random().toString(36).slice(2),
      direction: "in",
      protocol: "maya",
      counterpartChain: "BTC",
      counterpartAsset: "BTC",
      counterpartAmount: 0.01,
      counterpartTxHash: null,
      counterpartIsSynthetic: false,
      counterpartAddress: null,
      zcashTxid: null,
      zcashAddress: null,
      zecAmountZat: 100_000_000,
      usdValueAtSwap: null,
      counterpartUsdAtSwap: null,
      venueDepositAddress: null,
      timestamp: 1_785_000_000,
      status: "completed",
      ...over,
    }) as never;

  const appWithTransfers = async (transfers: unknown[]) => {
    const store = new MemoryStorePort();
    await store.upsert(transfers as never);
    return v1Routes({ chain: chainPort(), store, enabledProtocols: { maya: true } });
  };

  it("sums the venues' swap-time USD per chain and states how many transfers it covers", async () => {
    const app = await appWithTransfers([
      transfer({ counterpartChain: "BTC", usdValueAtSwap: 200 }),
      transfer({ counterpartChain: "BTC", usdValueAtSwap: 100 }),
      transfer({ counterpartChain: "BTC", usdValueAtSwap: null }),
      transfer({ counterpartChain: "ETH", usdValueAtSwap: 50 }),
    ]);
    const body = (await (await app.request("/v1/crosschain/flows")).json()) as {
      in: {
        usdAtSwap: number;
        usdCoveredTransfers: number;
        transfers: number;
        flows: { chain: string; usdAtSwap: number; usdCoveredTransfers: number }[];
      };
    };
    const btc = body.in.flows.find((f) => f.chain === "BTC");
    expect(btc).toMatchObject({ usdAtSwap: 300, usdCoveredTransfers: 2 });
    // The side total is the sum of its chains, coverage included — a reader must be able to
    // say "≥ $350 across 3 of 4 transfers" without adding anything up.
    expect(body.in).toMatchObject({ usdAtSwap: 350, usdCoveredTransfers: 3, transfers: 4 });
  });

  it("emits zero dollars over zero coverage rather than omitting the keys", async () => {
    // A missing key and an explicit zero read alike to a consumer and behave oppositely
    // under a spread — /v1 never omits, and a coverage of 0 is what says "unpriced".
    const app = await appWithTransfers([transfer({ usdValueAtSwap: null })]);
    const body = (await (await app.request("/v1/crosschain/flows")).json()) as {
      in: { usdAtSwap: number; usdCoveredTransfers: number };
    };
    expect(body.in.usdAtSwap).toBe(0);
    expect(body.in.usdCoveredTransfers).toBe(0);
  });
});

describe("GET /v1/rich-list", () => {
  /**
   * A pool that answers each of the rich list's queries by shape. The keyset itself is proven
   * against a real database in `rich-list-keyset.test.ts`; this asserts the wire contract: what
   * is emitted, what is never emitted, and what a null may mean.
   */
  const fakePool = {
    query: async (sql: string) => {
      // Order matters: the summary's meta query selects BOTH columns, so it has to be
      // matched before the height-only one that its text also contains.
      if (sql.includes("unattributed_zat")) {
        return { rows: [{ unattributed_zat: 79_800_000_000, computed_height: 3_400_001 }] };
      }
      if (sql.includes("computed_height FROM chain_rich_list_meta")) {
        return { rows: [{ computed_height: 3_400_001 }] };
      }
      if (sql.includes("width_bucket")) {
        return {
          rows: [
            { band: 0, addresses: 4, total_zat: 25_000_000 },
            { band: 6, addresses: 1, total_zat: 75_000_000 },
          ],
        };
      }
      if (sql.includes("count(*)::int AS addresses")) {
        return { rows: [{ addresses: 5, total_zat: 100_000_000 }] };
      }
      if (sql.includes("unnest(ARRAY[10, 100, 1000])")) {
        return {
          rows: [
            { count: 10, total_zat: 75_000_000 },
            { count: 100, total_zat: 100_000_000 },
            { count: 1000, total_zat: 100_000_000 },
          ],
        };
      }
      return {
        rows: [
          {
            address: "t1aaa",
            balance_zat: 75_000_000,
            received_zat: 90_000_000,
            first_height: 10,
            last_height: 20,
            rank: 1,
            tx_count: "7",
          },
          {
            // The row the backfill has not reached. Its count is unknown, not zero.
            address: "t1bbb",
            balance_zat: 25_000_000,
            received_zat: 25_000_000,
            first_height: 11,
            last_height: 21,
            rank: 2,
            tx_count: null,
          },
        ],
      };
    },
  } as unknown as Pool;

  const appWithPool = () =>
    v1Routes({ store: new MemoryStorePort(), pool: fakePool, enabledProtocols: {} });

  it("states an uncomputed transaction count as unknown, never as zero", async () => {
    const body = await (await appWithPool().request("/v1/rich-list")).json();
    const [counted, uncounted] = body.items;
    expect(counted.txCount).toBe(7);
    expect(counted).not.toHaveProperty("unknowns");
    // An address in this view has been in at least one transaction, so 0 is not a possible value.
    expect(uncounted.txCount).toBeNull();
    expect(uncounted.unknowns).toEqual({ txCount: "unmeasured" });
  });

  it("never publishes a label — the name would travel without its evidence basis", async () => {
    const body = await (await appWithPool().request("/v1/rich-list")).json();
    for (const item of body.items) expect(item).not.toHaveProperty("label");
  });

  it("carries the height the balances cover, and no total", async () => {
    const body = await (await appWithPool().request("/v1/rich-list")).json();
    expect(body.height).toBe(3_400_001);
    // A keyset page knows no total and must not imply one.
    expect(body).not.toHaveProperty("total");
    expect(body).not.toHaveProperty("addressCount");
  });

  it("rejects an unknown parameter rather than ignoring it", async () => {
    const res = await appWithPool().request("/v1/rich-list?top=100");
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("unknown_parameter");
  });

  it("answers 503, never 404, when the index is not configured", async () => {
    const app = v1Routes({ store: new MemoryStorePort(), enabledProtocols: {} });
    for (const path of ["/v1/rich-list", "/v1/rich-list/distribution"]) {
      const res = await app.request(path);
      expect(res.status).toBe(503);
      expect((await res.json()).error.code).toBe("upstream_unavailable");
    }
  });

  it("gives every share its denominator, and names what belongs to no address", async () => {
    const body = await (await appWithPool().request("/v1/rich-list/distribution")).json();
    for (const band of body.bands) {
      if (band.share === null) continue;
      // Transparent value, never circulating supply — a bare pct is read against the larger.
      expect(band.share.denominator).toBe(body.totalZat);
      expect(band.share.numerator).toBe(band.totalZat);
    }
    expect(body.topHolders[0]).toMatchObject({
      count: 10,
      share: { pct: 75, numerator: 75_000_000, denominator: 100_000_000 },
    });
    // The difference between this total and the node's transparent value pool.
    expect(body.unattributedZat).toBe(79_800_000_000);
    expect(body.height).toBe(3_400_001);
  });

  it("is listed in the descriptor, which cannot disagree with what is mounted", async () => {
    const body = await (await appWithPool().request("/v1")).json();
    expect(body.endpoints).toContain("GET /v1/rich-list");
    expect(body.endpoints).toContain("GET /v1/rich-list/distribution");
  });

  /*
   * The descriptor must list exactly what is mounted. It is machine-readable, so an endpoint
   * missing from it is one a client (or an assistant reading it) will conclude does not exist.
   */
  it("descriptor and route table enumerate exactly the same endpoints", async () => {
    const app = appWithPool();
    const body = await (await app.request("/v1")).json();

    /*
     * Compared by shape, not by spelling: the route says `:addr` and `:id` where the descriptor
     * says `{address}` and `{heightOrHash}`. What matters is that the same set of endpoints exists
     * on both sides.
     */
    const shape = (path: string) => path.replace(/:[A-Za-z0-9_]+|\{[A-Za-z0-9_]+\}/g, "{}");

    const mounted = new Map(
      app.routes
        .filter((r) => r.method === "GET" && r.path.startsWith("/v1") && !r.path.includes("*"))
        .map((r) => [shape(r.path), r.path] as const),
    );
    const declared = new Map(
      (body.endpoints as string[])
        .map((e) => e.replace(/^GET /, ""))
        .map((path) => [shape(path), path] as const),
    );

    const undocumented = [...mounted]
      .filter(([k]) => !declared.has(k))
      .map(([, v]) => v)
      .sort();
    const phantom = [...declared]
      .filter(([k]) => !mounted.has(k))
      .map(([, v]) => v)
      .sort();

    // Named separately: a route serving traffic that the contract denies exists is a different
    // failure from a contract promising a route nobody can call.
    expect({ undocumented, phantom }).toEqual({ undocumented: [], phantom: [] });
  });
});

describe("/v1/chain and /v1/status agree on the live facts", () => {
  /**
   * `/v1/status` and `/v1/chain` share one live-facts block, so a cold tracker's null carries an
   * `unknowns` reason on both.
   */
  it("names every unmeasured live figure in unknowns when the trackers are cold", async () => {
    const app = v1Routes({
      chain: chainPort(),
      store: new MemoryStorePort(),
      enabledProtocols: { maya: true, "near-intents": true, thorchain: false },
      extras: { price: { current: () => null }, stats24h: { current: () => null } },
    });
    for (const path of ["/v1/chain", "/v1/status"]) {
      const body = await (await app.request(path)).json();
      expect(body.fullyShieldedPct24h, path).toBeNull();
      expect(body.unknowns, path).toMatchObject({
        priceUsd: "unmeasured",
        priceChange24hPct: "unmeasured",
        txCount24h: "unmeasured",
        fullyShieldedPct24h: "unmeasured",
      });
    }
  });

  it("emits a null 24h change with its reason when the price tracker has no open", async () => {
    const app = v1Routes({
      chain: chainPort(),
      store: new MemoryStorePort(),
      enabledProtocols: { maya: true, "near-intents": true, thorchain: false },
      extras: { price: { current: () => ({ usd: 42, change24hPct: null }) } },
    });
    const body = await (await app.request("/v1/status")).json();
    expect(body.priceUsd).toBe(42);
    expect(body.priceChange24hPct).toBeNull();
    expect(body.unknowns.priceChange24hPct).toBe("unmeasured");
  });
});

describe("malformed input is a 400, never a 500", () => {
  it("refuses control characters in the path, the query or a cursor", async () => {
    const app = appWith();
    for (const url of [
      "http://x/v1/crosschain/transfers?chain=%00",
      "http://x/v1/transactions?cursor=MTcwMDAwMDAwMHwA%00",
      "http://x/v1/addresses/t1abc%00/transactions",
      "http://x/v1/blocks?limit=1%0a",
    ]) {
      const res = await app.request(url);
      expect(res.status, url).toBe(400);
    }
  });

  it("refuses a minZec larger than every coin that can exist", async () => {
    const res = await appWith().request("http://x/v1/crosschain/transfers?minZec=100000000000");
    expect(res.status).toBe(400);
    const ok = await appWith().request("http://x/v1/crosschain/transfers?minZec=1000");
    expect(ok.status).toBe(200);
  });
});

describe("/v1/labels", () => {
  const [held, unranked, spent] = Object.keys(ADDRESS_LABELS) as [string, string, string];
  const theft = Object.keys(ADDRESS_LABELS).find((a) => ADDRESS_LABELS[a]!.flag)!;
  const pool = {
    query: async (sql: string) => {
      if (sql.includes("computed_height")) return { rows: [{ computed_height: 3_400_001 }] };
      // One ranked balance, one the hourly pass has not ranked (rank 0), and no row for the rest,
      // which hold nothing.
      return {
        rows: [
          { address: held, balance_zat: 43_892_090_013_445, rank: 1 },
          { address: unranked, balance_zat: 2_869_648_329_284, rank: 0 },
        ],
      };
    },
  } as unknown as Pool;
  const app = () => v1Routes({ store: new MemoryStorePort(), pool, enabledProtocols: {} });
  const labels = async () => (await (await app().request("/v1/labels")).json()) as V1Labels;

  it("serves every labelled address, in the table's order, with whose claim each name is", async () => {
    const body = await labels();
    expect(body.labels.map((l) => l.address)).toEqual(Object.keys(ADDRESS_LABELS));
    expect(body.count).toBe(Object.keys(ADDRESS_LABELS).length);
    for (const label of body.labels) {
      expect(label.name).toBe(ADDRESS_LABELS[label.address]!.name);
      expect(label.source).toBe(ADDRESS_LABELS[label.address]!.source);
      expect(label.basis).toBe("external");
    }
    expect(body.labels[0]!.source).toMatch(/Arkham/);
  });

  it("carries the notice on every response, so a name never travels without it", async () => {
    const body = await labels();
    expect(body.notice).toBe(LABELS_NOTICE);
    expect(body.notice).toMatch(/not verified by this explorer/);
    expect(body.notice).toMatch(/transparent only/);
  });

  it("names the investigator behind a theft label, and no one behind the others", async () => {
    const body = await labels();
    const flagged = body.labels.find((l) => l.address === theft)!;
    expect(flagged.flag).toEqual({
      by: ADDRESS_LABELS[theft]!.flag!.by,
      url: ADDRESS_LABELS[theft]!.flag!.href,
    });
    expect(body.labels.find((l) => l.address === held)!.flag).toBeNull();
  });

  it("states why a rank is missing: holds nothing, or not ranked yet", async () => {
    const body = await labels();
    const byAddress = new Map(body.labels.map((l) => [l.address, l]));
    expect(byAddress.get(held)).toMatchObject({ balanceZat: 43_892_090_013_445, rank: 1 });
    expect(byAddress.get(held)).not.toHaveProperty("unknowns");
    expect(byAddress.get(unranked)).toMatchObject({
      rank: null,
      unknowns: { rank: "unmeasured" },
    });
    expect(byAddress.get(spent)).toMatchObject({
      balanceZat: 0,
      rank: null,
      unknowns: { rank: "nonexistent" },
    });
    expect(body.rankHeight).toBe(3_400_001);
  });

  it("refuses a parameter rather than ignoring it", async () => {
    expect((await app().request("/v1/labels?address=t1x")).status).toBe(400);
  });

  it("is listed in the descriptor", async () => {
    const body = await (await app().request("/v1")).json();
    expect(body.endpoints).toContain("GET /v1/labels");
  });
});
