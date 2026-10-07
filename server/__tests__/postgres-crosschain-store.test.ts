import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CrossChainGroupBy, CrossChainNarrowing, CrossChainTransfer } from "@/domain";
import { createPool } from "../pg-pool";
import { PostgresStorePort } from "../postgres-crosschain-store";
import { MemoryStorePort, type CrossChainStorePort } from "../crosschain-store";

/**
 * Proves the two storage adapters are interchangeable: Postgres and the in-memory store return
 * the same pages for the same cursors. Cursors are opaque tokens minted by one adapter and spent
 * against whichever is serving; if ordering or seek semantics differ, pages silently skip or
 * repeat rows, which only shows up when timestamps tie.
 *
 * Needs a real database, so it skips unless TEST_DATABASE_URL is set:
 *
 *   docker run -d --name pgtest -e POSTGRES_PASSWORD=test -e POSTGRES_DB=explorer \
 *     -p 55432:5432 postgres:17
 *   TEST_DATABASE_URL=postgres://postgres:test@localhost:55432/explorer npx vitest run --no-file-parallelism server
 */
const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

/** Empties the store's tables before a suite, on a connection of the test's own. */
async function truncate(): Promise<void> {
  const pool = createPool(DATABASE_URL);
  try {
    await pool.query("TRUNCATE crosschain_transfer, ingest_state");
  } finally {
    await pool.end();
  }
}

function transfer(id: string, timestamp: number, over: Partial<CrossChainTransfer> = {}) {
  return {
    id,
    direction: "in",
    protocol: "maya",
    counterpartChain: "BTC",
    counterpartAsset: "BTC",
    counterpartAmount: 0.01,
    counterpartTxHash: null,
    counterpartIsSynthetic: false,
    counterpartAddress: "bc1qexample",
    zcashTxid: null,
    zcashAddress: "t1Mv595nLBUxJxKAfAZAG9RjhibExEErmMf",
    zecAmountZat: 100_000_000,
    usdValueAtSwap: 497.74,
    counterpartUsdAtSwap: null,
    venueDepositAddress: null,
    status: "completed",
    timestamp,
    ...over,
  } satisfies CrossChainTransfer;
}

/** Ten rows, with a deliberate three-way tie in the middle. */
const ROWS: CrossChainTransfer[] = [
  ...Array.from({ length: 4 }, (_, i) => transfer(`maya-${i}`, 1_785_000_000 - i * 60)),
  transfer("maya-tie-a", 1_785_000_000 - 300),
  transfer("maya-tie-b", 1_785_000_000 - 300),
  transfer("maya-tie-c", 1_785_000_000 - 300),
  ...Array.from({ length: 3 }, (_, i) => transfer(`maya-z${i}`, 1_784_999_000 - i * 60)),
];

/** Walks every page forwards, returning the ids in the order the reader would see them. */
async function walkForwards(store: CrossChainStorePort, limit: number): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 50; guard += 1) {
    const page = await store.list({ before: cursor, limit });
    ids.push(...page.items.map((t) => t.id));
    if (!page.nextCursor) return ids;
    cursor = page.nextCursor;
  }
  throw new Error("pagination did not terminate");
}

describeDb("PostgresStorePort matches the in-memory store", () => {
  let pg: PostgresStorePort;
  let memory: MemoryStorePort;

  beforeAll(async () => {
    pg = new PostgresStorePort(DATABASE_URL as string);
    await pg.migrate("server/schema.sql");
    await truncate();
    memory = new MemoryStorePort();
    await pg.upsert(ROWS);
    await memory.upsert(ROWS);
  });

  afterAll(async () => {
    await pg?.close();
  });

  it("stores every row", async () => {
    const page = await pg.list({ limit: 100 });
    expect(page.items).toHaveLength(ROWS.length);
  });

  it("returns identical page sequences at every page size", async () => {
    for (const limit of [1, 2, 3, 4, 7, 10]) {
      const fromPg = await walkForwards(pg, limit);
      const fromMemory = await walkForwards(memory, limit);
      expect(fromPg, `limit=${limit}`).toEqual(fromMemory);
      expect(new Set(fromPg).size, `limit=${limit} had duplicates`).toBe(ROWS.length);
    }
  });

  it("orders a tie by id descending, like the row-value comparison it will use", async () => {
    const ids = (await pg.list({ limit: 100 })).items.map((t) => t.id);
    const tie = ids.filter((id) => id.startsWith("maya-tie"));
    expect(tie).toEqual(["maya-tie-c", "maya-tie-b", "maya-tie-a"]);
  });

  it("pages backwards to exactly the page it came from", async () => {
    const first = await pg.list({ limit: 3 });
    const second = await pg.list({ before: first.nextCursor ?? undefined, limit: 3 });
    const back = await pg.list({ after: second.prevCursor ?? undefined, limit: 3 });
    expect(back.items.map((t) => t.id)).toEqual(first.items.map((t) => t.id));
    // And the memory store agrees, cursor for cursor.
    const memFirst = await memory.list({ limit: 3 });
    const memSecond = await memory.list({ before: memFirst.nextCursor ?? undefined, limit: 3 });
    expect(second.items.map((t) => t.id)).toEqual(memSecond.items.map((t) => t.id));
  });

  it("resolves a garbage cursor to the first page rather than erroring", async () => {
    const first = (await pg.list({ limit: 3 })).items.map((t) => t.id);
    for (const bad of ["", "!!!!", "x".repeat(2000), "bm90LWEtY3Vyc29y"]) {
      expect((await pg.list({ before: bad, limit: 3 })).items.map((t) => t.id)).toEqual(first);
    }
  });

  it("hides venue settlement legs from lists but still resolves them by id", async () => {
    await pg.upsert([
      transfer("maya-cacao", 1_785_000_001, {
        counterpartChain: "MAYA",
        counterpartAsset: "CACAO",
      }),
    ]);
    const ids = (await pg.list({ limit: 100 })).items.map((t) => t.id);
    expect(ids).not.toContain("maya-cacao");
    expect((await pg.get("maya-cacao"))?.counterpartChain).toBe("MAYA");
    expect((await pg.list({ limit: 100 }, { includeProtocolLegs: true })).items.length).toBe(
      ROWS.length + 1,
    );
  });

  it("finds the crossings a Zcash txid settled, newest first, without settlement legs", async () => {
    const leg = "ab".repeat(32);
    const rows = [
      transfer("near-leg-old", 1_700_000_000, { zcashTxid: leg, protocol: "near-intents" }),
      transfer("near-leg-new", 1_700_000_600, { zcashTxid: leg, protocol: "near-intents" }),
      // A venue's own settlement leg shares the txid and must not be announced as a swap.
      transfer("maya-leg-cacao", 1_700_000_300, {
        zcashTxid: leg,
        counterpartChain: "MAYA",
        counterpartAsset: "CACAO",
      }),
      transfer("near-other", 1_700_000_900, { zcashTxid: "cd".repeat(32) }),
    ];
    await pg.upsert(rows);
    await memory.upsert(rows);
    for (const store of [pg, memory] as CrossChainStorePort[]) {
      const all = await store.byZcashTxid(leg, 10);
      expect(all.transfers.map((t) => t.id)).toEqual(["near-leg-new", "near-leg-old"]);
      expect(all.total).toBe(2);
      // Capped: the rows shrink, the total does not — a bounded list states what it left out.
      const capped = await store.byZcashTxid(leg, 1);
      expect(capped.transfers.map((t) => t.id)).toEqual(["near-leg-new"]);
      expect(capped.total).toBe(2);
      expect(await store.byZcashTxid("ef".repeat(32), 10)).toEqual({ transfers: [], total: 0 });
    }
  });

  it("upserts rather than duplicating, and reports only genuinely new rows", async () => {
    const added = await pg.upsert([transfer("maya-0", 1_785_000_000, { status: "pending" })]);
    expect(added).toBe(0);
    expect((await pg.get("maya-0"))?.status).toBe("pending");
  });

  it("derives zcash_address_kind at ingest, so the statistic is a GROUP BY", async () => {
    await pg.upsert([
      transfer("maya-unified", 1_784_000_000, {
        zcashAddress:
          "u103es06kwh0vumpqutx3kfyy5v8s0np5zyv2u3dq3gqxza78r2s2zh4vekx5x0dznkk2jvlufg0cruvektv588m4l70gcwa8yugd56e25",
      }),
    ]);
    const buckets = await pg.countByAddressKind("in");
    const unified = buckets.find((b) => b.kind === "unified");
    expect(unified?.transfers).toBe(1);
  });

  it("keeps numeric columns numeric — a string here turns every total into concatenation", async () => {
    const row = await pg.get("maya-0");
    expect(typeof row?.zecAmountZat).toBe("number");
    expect(typeof row?.timestamp).toBe("number");
    expect(typeof row?.usdValueAtSwap).toBe("number");
  });

  it("persists ingest state so a restart resumes the backfill", async () => {
    await pg.writeIngestState("backfill:maya", { offset: 350, done: false });
    expect(await pg.readIngestState("backfill:maya")).toEqual({ offset: 350, done: false });
  });

  it("derives venue liveness from the stored last success", async () => {
    await pg.markSuccess("maya", 1_785_000_000);
    const fresh = await pg.health(["maya"], 1_785_000_060);
    expect(fresh[0]?.live).toBe(true);
    const stale = await pg.health(["maya"], 1_785_000_000 + 11 * 60);
    expect(stale[0]?.live).toBe(false);
  });
});

/**
 * The chain filters, where the two stores are not one implementation: the in-memory store and
 * the fixtures share `matchesCrossChainFilters`, while the SQL is a second, hand-written
 * statement of the rule. These cases assert the two agree row for row.
 */
describeDb("chain filters agree between Postgres and memory", () => {
  let pg: PostgresStorePort;
  let memory: MemoryStorePort;

  /** Inbound from BTC/ETH/BTC, outbound to SOL/BTC/SOL. */
  const CHAIN_ROWS: CrossChainTransfer[] = (
    [
      ["a", "in", "BTC"],
      ["b", "in", "ETH"],
      ["c", "in", "BTC"],
      ["d", "out", "SOL"],
      ["e", "out", "BTC"],
      ["f", "out", "SOL"],
    ] as const
  ).map(([id, direction, chain], i) =>
    transfer(`chain-${id}`, 1_786_000_000 - i * 60, {
      direction,
      counterpartChain: chain,
      counterpartAsset: chain,
    }),
  );

  beforeAll(async () => {
    pg = new PostgresStorePort(DATABASE_URL as string);
    await pg.migrate("server/schema.sql");
    await truncate();
    memory = new MemoryStorePort();
    await pg.upsert(CHAIN_ROWS);
    await memory.upsert(CHAIN_ROWS);
  });

  afterAll(async () => {
    await pg?.close();
  });

  const CASES: [string, Parameters<CrossChainStorePort["list"]>[1]][] = [
    ["source BTC", { sourceChains: ["BTC"] }],
    ["source ZEC — every outbound row", { sourceChains: ["ZEC"] }],
    ["source BTC or ZEC — both arms of the OR", { sourceChains: ["BTC", "ZEC"] }],
    ["destination SOL", { destinationChains: ["SOL"] }],
    ["destination ZEC", { destinationChains: ["ZEC"] }],
    ["both sides", { sourceChains: ["BTC"], destinationChains: ["ZEC"] }],
    [
      "two foreign chains — legitimately empty",
      { sourceChains: ["BTC"], destinationChains: ["SOL"] },
    ],
    ["with a direction", { direction: "in", sourceChains: ["BTC", "ETH"] }],
    ["with a venue", { protocol: "maya", sourceChains: ["BTC"] }],
    ["a chain we hold no rows for", { sourceChains: ["NOTACHAIN"] }],
    ["a minimum value", { minUsdAtSwap: 400 }],
    ["a minimum above everything", { minUsdAtSwap: 10_000_000 }],
    ["a minimum with a chain", { sourceChains: ["BTC"], minUsdAtSwap: 400 }],
    ["a minimum ZEC amount", { minZecZat: 100_00000000 }],
    ["a minimum ZEC amount above everything", { minZecZat: 21_000_000_00000000 }],
    // Direction-blind: BTC at whichever end it sits, which is what one ticker means. The two
    // directional filters AND together, so asking this as source+destination is the empty set.
    ["counterpart BTC, either direction", { counterpartChains: ["BTC"] }],
    ["counterpart BTC, inbound only", { counterpartChains: ["BTC"], direction: "in" }],
    ["counterpart chain we hold nothing for", { counterpartChains: ["NOTACHAIN"] }],
  ];

  for (const [what, options] of CASES) {
    it(`${what}: same rows, and the count matches the list`, async () => {
      const fromPg = (await pg.list({ limit: 100 }, options)).items.map((t) => t.id);
      const fromMemory = (await memory.list({ limit: 100 }, options)).items.map((t) => t.id);
      expect(fromPg).toEqual(fromMemory);
      // The totals line quotes `countFiltered` above a table filled by `list`. Two
      // statements of one WHERE is how those came to disagree once already.
      expect(await pg.countFiltered(options)).toBe(fromPg.length);
    });
  }

  it("filters BEFORE the slice, so a page is full and its cursor skips nothing", async () => {
    const first = await pg.list({ limit: 2 }, { destinationChains: ["ZEC"] });
    expect(first.items.map((t) => t.id)).toEqual(["chain-a", "chain-b"]);
    const second = await pg.list(
      { limit: 2, before: first.nextCursor ?? undefined },
      { destinationChains: ["ZEC"] },
    );
    expect(second.items.map((t) => t.id)).toEqual(["chain-c"]);
    expect(second.nextCursor).toBeNull();
  });

  it("still hides settlement legs", async () => {
    await pg.upsert([
      transfer("chain-cacao", 1_786_000_001, {
        counterpartChain: "MAYA",
        counterpartAsset: "CACAO",
      }),
    ]);
    expect((await pg.list({ limit: 100 }, { sourceChains: ["MAYA"] })).items).toEqual([]);
    expect(await pg.countFiltered({ sourceChains: ["MAYA"] })).toBe(0);
  });
});

/**
 * The narrowed aggregate, held to the same answers in SQL and in memory. `aggregateCrossChain`
 * and the `GROUP BY` in `postgres-crosschain-store.ts` are two implementations of one question; this checks
 * what is easy to write differently: the window's half-open edges, the UTC month a boundary
 * transfer belongs to, whether an unpriced row raises the coverage count, and whether an empty
 * slice comes back as zeros or as nothing.
 */
describeDb("the narrowed aggregate agrees between Postgres and memory", () => {
  let pg: PostgresStorePort;
  let memory: MemoryStorePort;

  const at = (iso: string) => Math.floor(Date.parse(iso) / 1000);
  const JULY = {
    fromTimestamp: at("2026-07-01T00:00:00Z"),
    toTimestamp: at("2026-08-01T00:00:00Z"),
  };

  /**
   * Rows straddling three months, both directions, two venues, and a mix of priced and
   * unpriced legs — the last one being what makes `usdCoveredTransfers` mean anything.
   * Two rows sit exactly on a month boundary, which is the case a closed range gets wrong.
   */
  const ROWS_FOR_AGGREGATE: CrossChainTransfer[] = [
    transfer("agg-a", at("2026-06-30T23:59:59Z"), { counterpartChain: "BTC", zecAmountZat: 100 }),
    transfer("agg-b", at("2026-07-01T00:00:00Z"), { counterpartChain: "BTC", zecAmountZat: 200 }),
    transfer("agg-c", at("2026-07-15T12:00:00Z"), {
      counterpartChain: "ETH",
      direction: "out",
      counterpartAsset: "ETH",
      zecAmountZat: 400,
      protocol: "near-intents",
      id: "near-agg-c",
    }),
    transfer("agg-d", at("2026-07-31T23:59:59Z"), {
      counterpartChain: "BTC",
      zecAmountZat: 800,
      // No published price: it still counts as a transfer and adds no dollars, which is the
      // whole of what makes the USD total a floor.
      usdValueAtSwap: null,
    }),
    transfer("agg-e", at("2026-08-01T00:00:00Z"), { counterpartChain: "SOL", zecAmountZat: 1_600 }),
  ];

  beforeAll(async () => {
    pg = new PostgresStorePort(DATABASE_URL as string);
    await pg.migrate("server/schema.sql");
    await truncate();
    memory = new MemoryStorePort();
    await pg.upsert(ROWS_FOR_AGGREGATE);
    await memory.upsert(ROWS_FOR_AGGREGATE);
  });

  afterAll(async () => {
    await pg?.close();
  });

  const CASES: [string, CrossChainNarrowing, CrossChainGroupBy][] = [
    ["everything, ungrouped", {}, "none"],
    ["everything, by chain", {}, "chain"],
    ["everything, by venue", {}, "venue"],
    ["everything, by month — the boundary rows", {}, "month"],
    ["everything, by day", {}, "day"],
    ["July only, ungrouped", JULY, "none"],
    ["July only, by chain", JULY, "chain"],
    ["one chain in one month", { ...JULY, sourceChains: ["BTC"] }, "month"],
    ["one direction", { direction: "out" }, "chain"],
    ["one venue", { protocol: "near-intents" }, "chain"],
    ["a value floor", { minUsdAtSwap: 400 }, "chain"],
    ["a ZEC floor", { minZecZat: 100_00000000 }, "chain"],
    ["one counterpart chain, either direction", { counterpartChains: ["BTC"] }, "month"],
    ["a slice that matches nothing", { sourceChains: ["NOTACHAIN"] }, "chain"],
    ["a window that matches nothing", { fromTimestamp: at("2030-01-01T00:00:00Z") }, "month"],
  ];

  for (const [what, filters, groupBy] of CASES) {
    it(`${what}: identical totals and groups`, async () => {
      expect(await pg.aggregate(filters, groupBy)).toEqual(
        await memory.aggregate(filters, groupBy),
      );
    });
  }

  it("counts a month exactly once at its boundaries", async () => {
    const a = await pg.aggregate(JULY, "none");
    // agg-b (the first instant of July) and agg-c and agg-d (the last second) are in;
    // agg-a (June) and agg-e (the first instant of August) are out.
    expect(a.totals.in.transfers + a.totals.out.transfers).toBe(3);
    expect(a.totals.in.zecAmountZat).toBe(1_000);
    expect(a.totals.out.zecAmountZat).toBe(400);
  });

  it("keeps the dollar total a floor by counting only the legs that carried a price", async () => {
    const a = await pg.aggregate({ ...JULY, sourceChains: ["BTC"] }, "none");
    expect(a.totals.in.transfers).toBe(2);
    expect(a.totals.in.usdCoveredTransfers).toBe(1);
  });

  it("reports a slice that matched nothing as zeros, never as an absence", async () => {
    // The distinction every layer above depends on: this is a measurement — no ZEC crossed
    // from that chain — and must stay distinguishable from a read that failed.
    const a = await pg.aggregate({ sourceChains: ["NOTACHAIN"] }, "chain");
    expect(a.totals.in.transfers).toBe(0);
    expect(a.groups).toEqual([]);
    expect(a.firstAt).toBe(0);
  });

  it("excludes settlement legs from the aggregate as it does from the list", async () => {
    await pg.upsert([
      transfer("agg-cacao", at("2026-07-10T00:00:00Z"), {
        counterpartChain: "MAYA",
        counterpartAsset: "CACAO",
        zecAmountZat: 999_999,
      }),
    ]);
    const a = await pg.aggregate(JULY, "chain");
    expect(a.groups.map((g) => g.key)).not.toContain("MAYA");
  });
});

/**
 * The largest-transfers ranking.
 *
 * The property worth testing is the refusal: ranking by dollars drops rows the venue never
 * priced, rather than treating an unknown value as zero and placing it last as though it were
 * small. A ranking must also be stable, or "the largest crossing" changes between two readings
 * of unchanged data.
 */
describeDb("top transfers", () => {
  let pg: PostgresStorePort;
  let memory: MemoryStorePort;

  const ROWS_FOR_TOP: CrossChainTransfer[] = [
    transfer("top-small", 1_786_000_000, { zecAmountZat: 100, usdValueAtSwap: 10 }),
    transfer("top-big-zec", 1_786_000_060, { zecAmountZat: 10_000, usdValueAtSwap: 5 }),
    transfer("top-big-usd", 1_786_000_120, { zecAmountZat: 500, usdValueAtSwap: 9_000 }),
    transfer("top-unpriced", 1_786_000_180, { zecAmountZat: 9_000, usdValueAtSwap: null }),
  ];

  beforeAll(async () => {
    pg = new PostgresStorePort(DATABASE_URL as string);
    await pg.migrate("server/schema.sql");
    await truncate();
    memory = new MemoryStorePort();
    await pg.upsert(ROWS_FOR_TOP);
    await memory.upsert(ROWS_FOR_TOP);
  });

  afterAll(async () => {
    await pg?.close();
  });

  it("ranks by ZEC, including rows with no published price", async () => {
    const ids = (await pg.top({}, "zec", 10)).map((t) => t.id);
    expect(ids).toEqual(["top-big-zec", "top-unpriced", "top-big-usd", "top-small"]);
    expect((await memory.top({}, "zec", 10)).map((t) => t.id)).toEqual(ids);
  });

  it("ranks by dollars and DROPS the unpriced row rather than calling it worth nothing", async () => {
    const ids = (await pg.top({}, "usd", 10)).map((t) => t.id);
    expect(ids).toEqual(["top-big-usd", "top-small", "top-big-zec"]);
    expect(ids).not.toContain("top-unpriced");
    expect((await memory.top({}, "usd", 10)).map((t) => t.id)).toEqual(ids);
  });

  /**
   * The other end. Asserted against the reverse of the ranking above rather than a fresh literal,
   * since that is the property.
   */
  it("ranks from the smallest end, in both stores, as the exact reverse", async () => {
    const largest = (await pg.top({}, "zec", 10)).map((t) => t.id);
    const smallest = (await pg.top({}, "zec", 10, "smallest")).map((t) => t.id);
    expect(smallest).toEqual([...largest].reverse());
    expect((await memory.top({}, "zec", 10, "smallest")).map((t) => t.id)).toEqual(smallest);
  });

  /**
   * An unpriced transfer is a value nobody published, not a cheap one; ranking it smallest would
   * put it in the top slot of the answer.
   */
  it("still drops the unpriced row when asked for the SMALLEST by dollars", async () => {
    const ids = (await pg.top({}, "usd", 10, "smallest")).map((t) => t.id);
    expect(ids[0]).not.toBe("top-unpriced");
    expect(ids).not.toContain("top-unpriced");
    expect((await memory.top({}, "usd", 10, "smallest")).map((t) => t.id)).toEqual(ids);
  });

  it("honours the narrowing and the limit", async () => {
    // The floor removes `top-big-zec` ($5) and `top-unpriced` (no price), so the largest by ZEC
    // among what survives is `top-big-usd` at 500. A ranking is over the slice: applying the
    // limit before the filter would return the biggest rows overall.
    expect((await pg.top({ minUsdAtSwap: 9 }, "zec", 1)).map((t) => t.id)).toEqual(["top-big-usd"]);
    expect((await memory.top({ minUsdAtSwap: 9 }, "zec", 1)).map((t) => t.id)).toEqual([
      "top-big-usd",
    ]);
  });
});
