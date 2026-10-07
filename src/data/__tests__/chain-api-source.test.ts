import { afterEach, describe, expect, it, vi } from "vitest";
import { blockSummaryOf, type Block } from "@/domain";
import { readApiConfig, resetApiBreaker } from "../api-request";
import { createChainApiSource } from "../chain-api-source";
import { isTransientUpstream } from "@/lib/transient-upstream";

/**
 * The adapter's contract, tested against a stubbed `fetch`: which status codes mean
 * "missing", which mean "reject", and whether a malformed payload fails loudly instead of
 * rendering a blank cell.
 */

const config = { baseUrl: "https://api.example", token: "tkn" };

/** A complete block body: `isBlock` is a version-skew tripwire, so a stub must satisfy it. */
const block = {
  height: 100,
  hash: "a".repeat(64),
  prevHash: "b".repeat(64),
  timestamp: 1_700_000_000,
  sizeBytes: 1234,
  txids: ["c".repeat(64)],
  composition: { transparentTxs: 1, mixedTxs: 0, shieldedTxs: 0 },
  version: 4,
  difficulty: 146_914_688.75,
  bits: "1c00e9e0",
  nonce: "d".repeat(64),
  merkleRoot: "e".repeat(64),
  finalSaplingRoot: "f".repeat(64),
  finalOrchardRoot: "0".repeat(64),
  miner: { kind: "transparent", address: "t1MinerFixtureAddress00000001" },
  coinbaseTag: null,
  fundingStreams: [],
  blockRewardZat: 137_724_743,
  totalFeeZat: null,
};

const tx = {
  txid: "c".repeat(64),
  blockHeight: 100,
  blockHash: "0b".repeat(32),
  timestamp: 1_700_000_000,
  isCoinbase: false,
  version: 5,
  sizeBytes: 400,
  lockTime: 0,
  expiryHeight: null,
  rawHex: null,
  feeZat: 15_000,
  bindingSigValid: null,
  transparentInputs: [],
  transparentOutputs: [],
  sprout: null,
  sapling: null,
  orchard: null,
  ironwood: null,
};

const facts = {
  height: 1_000_000,
  bestBlockHash: "f".repeat(64),
  lastBlockTimestamp: 1_700_000_000,
  circulatingSupplyZat: 1_600_000_000_000_000,
};

/**
 * Routes by URL, because depth-aware caching makes some methods consult /chain/info
 * before their own resource. `fallback` answers everything not explicitly routed.
 */
function stub(status: number, body: unknown, routes: Record<string, unknown> = {}) {
  return vi.fn().mockImplementation((url: string) => {
    for (const [needle, routed] of Object.entries(routes)) {
      if (String(url).includes(needle)) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(routed),
        } as unknown as Response);
      }
    }
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    } as unknown as Response);
  });
}

/** The init object of the first call whose URL contains `needle`. */
function initFor(fetchMock: ReturnType<typeof vi.fn>, needle: string) {
  const call = fetchMock.mock.calls.find(([url]) => String(url).includes(needle));
  if (!call) throw new Error(`no fetch call matched ${needle}`);
  return call[1] as { next?: { revalidate?: number } };
}

afterEach(() => {
  vi.unstubAllGlobals();
  // The breaker is module state (per warm instance); reset it between cases.
  resetApiBreaker();
});

describe("readApiConfig", () => {
  it("requires both a URL and a token", () => {
    expect(readApiConfig({ CROSSCHAIN_API_URL: "https://x" })).toBeNull();
    expect(readApiConfig({ EXPLORER_API_TOKEN: "t" })).toBeNull();
    expect(readApiConfig({})).toBeNull();
  });

  it("strips a trailing slash so paths never double up", () => {
    // `https://x//chain/info` would 404 on a strict router.
    expect(readApiConfig({ CROSSCHAIN_API_URL: "https://x/", EXPLORER_API_TOKEN: "t" })).toEqual({
      baseUrl: "https://x",
      token: "t",
    });
  });
});

describe("error contract", () => {
  it("resolves 404 to undefined, so routes render a designed not-found", async () => {
    vi.stubGlobal("fetch", stub(404, { error: "not found" }, { "/chain/info": facts }));
    const source = createChainApiSource(config);
    expect(await source.getBlock("999")).toBeUndefined();
    expect(await source.getTransaction("d".repeat(64))).toBeUndefined();
    expect(await source.getAddress("t1x")).toBeUndefined();
  });

  it("rejects on 5xx rather than masquerading as missing data", async () => {
    // The core of the contract: a rebooting box must reach the error boundary, not render as
    // "this block does not exist".
    vi.stubGlobal("fetch", stub(502, {}));
    const source = createChainApiSource(config);
    await expect(source.getBlock("100")).rejects.toThrow(/502/);
    // The breaker may already be open here (`getBlock` alone makes several requests), so the
    // assertion is the property: a transient rejection, never `undefined`.
    for (const call of [
      () => source.getTransaction("d".repeat(64)),
      () => source.listBlocks({ limit: 10 }),
    ]) {
      const err = await call().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect(isTransientUpstream(err)).toBe(true);
    }
  });

  it("rejects a malformed payload instead of rendering it", async () => {
    // Version skew during a deploy. Failing loudly beats a page of blank cells.
    vi.stubGlobal("fetch", stub(200, { items: [{ nonsense: true }] }));
    await expect(createChainApiSource(config).listBlocks({ limit: 10 })).rejects.toThrow(
      /unrecognised/,
    );
  });

  it("reads a block LIST in either row shape, as the same rows", async () => {
    // The API builds list rows from the chain index without the header fields a detail page
    // shows; an API one deploy behind still sends whole blocks. Both must read as the same rows.
    const summary = blockSummaryOf(block as Block);
    expect(summary).not.toHaveProperty("txids");
    const read = async (row: object) => {
      vi.stubGlobal("fetch", stub(200, { items: [row], nextCursor: null, prevCursor: null }));
      return (await createChainApiSource(config).listBlocks({ limit: 1 })).items;
    };
    expect(await read(summary)).toEqual([summary]);
    expect(await read(block)).toEqual([summary]);
    vi.stubGlobal("fetch", stub(200, [summary, block]));
    expect(await createChainApiSource(config).listLatestBlocks(2)).toEqual([summary, summary]);
  });

  it("rejects a whole block list when one row is in neither shape", async () => {
    // All-or-nothing, like every adapter page: a row without its count would render a blank cell.
    const neither = { ...block, txids: undefined };
    vi.stubGlobal(
      "fetch",
      stub(200, { items: [block, neither], nextCursor: null, prevCursor: null }),
    );
    await expect(createChainApiSource(config).listBlocks({ limit: 2 })).rejects.toThrow(
      /unrecognised/,
    );
    const negative = { ...blockSummaryOf(block as Block), txCount: -1 };
    vi.stubGlobal("fetch", stub(200, [block, negative]));
    await expect(createChainApiSource(config).listLatestBlocks(2)).rejects.toThrow(/unrecognised/);
  });

  it("rejects a transaction whose feeZat arrived as a string", async () => {
    // A fee is `number | null` — never a string, and never 0 standing in for unknown.
    vi.stubGlobal("fetch", stub(200, { ...tx, feeZat: "15000" }));
    await expect(createChainApiSource(config).getTransaction(tx.txid)).rejects.toThrow(
      /unrecognised/,
    );
  });

  it("accepts a null fee, which means unknown", async () => {
    vi.stubGlobal("fetch", stub(200, { ...tx, feeZat: null }));
    const result = await createChainApiSource(config).getTransaction(tx.txid);
    expect(result?.feeZat).toBeNull();
  });

  it("accepts a null blockHeight, which means mempool", async () => {
    vi.stubGlobal("fetch", stub(200, { ...tx, blockHeight: null }));
    const result = await createChainApiSource(config).getTransaction(tx.txid);
    expect(result?.blockHeight).toBeNull();
  });
});

describe("requests", () => {
  it("sends the bearer token on every call", async () => {
    const fetchMock = stub(200, block, { "/chain/info": facts });
    vi.stubGlobal("fetch", fetchMock);
    await createChainApiSource(config).getBlock("100");

    for (const [, init] of fetchMock.mock.calls) {
      expect((init as RequestInit).headers).toMatchObject({ authorization: "Bearer tkn" });
    }
  });

  it("passes cursors through opaquely, without inspecting them", async () => {
    const fetchMock = stub(200, { items: [], nextCursor: null, prevCursor: null });
    vi.stubGlobal("fetch", fetchMock);
    await createChainApiSource(config).listBlocks({ before: "OPAQUE==", limit: 5 });

    const [url] = fetchMock.mock.calls[0]!;
    // Encoded, not decoded or rebuilt: above `data/` a cursor is a token, not a structure.
    expect(String(url)).toContain("before=OPAQUE%3D%3D");
    expect(String(url)).toContain("limit=5");
  });

  it("omits the kind filter when listing all transactions", async () => {
    const fetchMock = stub(200, { items: [], nextCursor: null, prevCursor: null });
    vi.stubGlobal("fetch", fetchMock);
    await createChainApiSource(config).listTransactions({ limit: 5 }, "all");
    expect(String(fetchMock.mock.calls[0]![0])).not.toContain("kind=");
  });

  it("sends the kind filter when one is chosen", async () => {
    const fetchMock = stub(200, { items: [], nextCursor: null, prevCursor: null });
    vi.stubGlobal("fetch", fetchMock);
    await createChainApiSource(config).listTransactions({ limit: 5 }, "shielded");
    expect(String(fetchMock.mock.calls[0]![0])).toContain("kind=shielded");
  });

  it("sends a mixed direction sub-filter as its own kind", async () => {
    const fetchMock = stub(200, {
      items: [],
      nextCursor: null,
      prevCursor: null,
      applied: { kind: "shielding" },
    });
    vi.stubGlobal("fetch", fetchMock);
    await createChainApiSource(config).listTransactions({ limit: 5 }, "shielding");
    expect(String(fetchMock.mock.calls[0]![0])).toContain("kind=shielding");
  });

  it("REFUSES a sub-filtered page the API did not narrow", async () => {
    /*
     * An API that predates `kind=shielding` degrades it to "all" and returns every transaction
     * under a "MIXED · SHIELDING" chip — a well-formed page, so only the echo can catch it.
     */
    const fetchMock = stub(200, {
      items: [tx],
      nextCursor: null,
      prevCursor: null,
      applied: { kind: "all" },
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      createChainApiSource(config).listTransactions({ limit: 5 }, "unshielding"),
    ).rejects.toThrow(/applied kind=\[all\].*asking kind=\[unshielding\]/);
  });

  it("REFUSES a sub-filtered page from an API too old to echo at all", async () => {
    // An absent key and a wrong one are the same failure; leniency about the absent case would
    // accept exactly the deploy skew this guards.
    const fetchMock = stub(200, { items: [tx], nextCursor: null, prevCursor: null });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      createChainApiSource(config).listTransactions({ limit: 5 }, "shielding"),
    ).rejects.toThrow(/applied kind=\[undefined\]/);
  });

  it("does NOT require an echo for the kinds an older API serves correctly", async () => {
    // Scoped to the two mixed-direction filters: failing every /txs view over a missing echo
    // would turn version skew into an outage.
    const fetchMock = stub(200, { items: [tx], nextCursor: null, prevCursor: null });
    vi.stubGlobal("fetch", fetchMock);
    for (const kind of ["all", "transparent", "shielded", "mixed", "coinbase"] as const) {
      await expect(
        createChainApiSource(config).listTransactions({ limit: 5 }, kind),
      ).resolves.toMatchObject({ items: [tx] });
    }
  });

  it("escapes an address rather than interpolating it into the path", async () => {
    const fetchMock = stub(404, {});
    vi.stubGlobal("fetch", fetchMock);
    await createChainApiSource(config).getAddress("t1x/../../etc");
    expect(String(fetchMock.mock.calls[0]![0])).toContain("t1x%2F..%2F..%2Fetc");
  });

  it("caches deep blocks long and near-tip blocks short", async () => {
    // Tip is 1,000,000: height 100 is immutable history, height 999,990 is inside reorg depth
    // and its height→block mapping can still change.
    const fetchMock = stub(200, block, { "/chain/info": facts });
    vi.stubGlobal("fetch", fetchMock);
    const source = createChainApiSource(config);

    await source.getBlock("100");
    const deep = initFor(fetchMock, "/chain/blocks/100").next?.revalidate ?? 0;
    fetchMock.mockClear();

    await source.getBlock("999990");
    const shallow = initFor(fetchMock, "/chain/blocks/999990").next?.revalidate ?? 0;

    expect(deep).toBeGreaterThan(shallow);
    expect(shallow).toBeLessThanOrEqual(60);
  });

  it("falls back to the SHORT window when the tip cannot be learned", async () => {
    // Over-caching a reorgable block serves wrong data; under-caching an immutable one costs a
    // round trip, so failures fall back to the short window.
    const fetchMock = stub(200, block, { "/chain/info": { broken: true } });
    vi.stubGlobal("fetch", fetchMock);
    await createChainApiSource(config).getBlock("100");
    expect(initFor(fetchMock, "/chain/blocks/100").next?.revalidate).toBeLessThanOrEqual(60);
  });

  it("caches hash-addressed blocks long without consulting the tip", async () => {
    // A reorg mints a different hash; it never changes what an existing hash refers to.
    const fetchMock = stub(200, block);
    vi.stubGlobal("fetch", fetchMock);
    await createChainApiSource(config).getBlock("a".repeat(64));
    expect(fetchMock.mock.calls).toHaveLength(1);
    expect(initFor(fetchMock, "/chain/blocks/").next?.revalidate).toBe(3600);
  });

  it("barely caches the mempool, which has no immutable form", async () => {
    const fetchMock = stub(200, { items: [], totalPages: 0 });
    vi.stubGlobal("fetch", fetchMock);
    await createChainApiSource(config).listMempool(1, 10);
    const init = fetchMock.mock.calls[0]![1] as { next?: { revalidate?: number } };
    expect(init.next?.revalidate).toBeLessThanOrEqual(10);
  });
});

/**
 * Poller-backed facts must be normalised to an explicit `null` when absent: an absent key
 * survives `{ ...fixtures, ...facts }` in `data/index.ts` and would publish a fixture value
 * (such as a fake price) as live, while `null` overrides the spread.
 */
describe("unmeasured chain facts", () => {
  const pollerFields = [
    "priceUsd",
    "priceChange24hPct",
    "txCount24h",
    "fullyShieldedPct24h",
  ] as const;

  it("reports null — not absence — for every field the API omits", async () => {
    const fetchMock = stub(200, facts);
    vi.stubGlobal("fetch", fetchMock);
    const result = await createChainApiSource(config).getChainFacts();

    for (const field of pollerFields) {
      // `toBeNull` alone would pass on `undefined`; the key must be present and null, since that
      // presence is what stops a fixture leaking through.
      expect(field in result, `${field} must be present`).toBe(true);
      expect(result[field], `${field} must be null`).toBeNull();
    }
  });

  it("passes measured values through untouched", async () => {
    const fetchMock = stub(200, {
      ...facts,
      priceUsd: 41.5,
      priceChange24hPct: -2.25,
      txCount24h: 8_241,
      fullyShieldedPct24h: 61,
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await createChainApiSource(config).getChainFacts();

    expect(result.priceUsd).toBe(41.5);
    // A negative 24h change is a real reading; dropping it would turn every down day into
    // "unavailable".
    expect(result.priceChange24hPct).toBe(-2.25);
    expect(result.txCount24h).toBe(8_241);
    expect(result.fullyShieldedPct24h).toBe(61);
  });

  it("treats a zero as measured, not as missing", async () => {
    // 0% fully shielded and a 0.0% price move are findings. A falsiness check
    // (`price ? … : null`) would erase them.
    const fetchMock = stub(200, { ...facts, fullyShieldedPct24h: 0, priceChange24hPct: 0 });
    vi.stubGlobal("fetch", fetchMock);
    const result = await createChainApiSource(config).getChainFacts();

    expect(result.fullyShieldedPct24h).toBe(0);
    expect(result.priceChange24hPct).toBe(0);
  });

  it("rejects a non-finite or wrongly-typed price rather than rendering $NaN", async () => {
    const fetchMock = stub(200, {
      ...facts,
      priceUsd: Number.NaN,
      priceChange24hPct: "4.7",
      txCount24h: null,
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await createChainApiSource(config).getChainFacts();

    expect(result.priceUsd).toBeNull();
    expect(result.priceChange24hPct).toBeNull();
    expect(result.txCount24h).toBeNull();
  });
});

/**
 * Version skew on a nullable field. An API predating `ironwood` omits the key, and
 * `undefined` passes `txPools`' `tx.ironwood !== null` check, which would badge every
 * transaction IRONWOOD. A wrong badge reads as fact, so the validator must catch it.
 */
describe("skew on an absent nullable field", () => {
  // Rebuilt without the key rather than destructured out, which would leave an unused
  // binding that lint objects to.
  const withoutIronwood = Object.fromEntries(
    Object.entries(tx).filter(([key]) => key !== "ironwood"),
  );

  it("rejects a transaction whose ironwood key is missing entirely", async () => {
    const fetchMock = stub(200, [withoutIronwood], { "/chain/info": facts });
    vi.stubGlobal("fetch", fetchMock);
    await expect(createChainApiSource(config).listLatestTransactions(5)).rejects.toThrow(
      /unrecognised/i,
    );
  });

  it("accepts an explicit null, which is what a pre-activation transaction carries", async () => {
    const fetchMock = stub(200, [{ ...tx, ironwood: null }], { "/chain/info": facts });
    vi.stubGlobal("fetch", fetchMock);
    const txs = await createChainApiSource(config).listLatestTransactions(5);
    expect(txs[0]?.ironwood).toBeNull();
  });

  it("accepts a real bundle", async () => {
    const bundle = { actions: 2, valueBalanceZat: 300_000_000 };
    const fetchMock = stub(200, [{ ...tx, ironwood: bundle }], { "/chain/info": facts });
    vi.stubGlobal("fetch", fetchMock);
    const txs = await createChainApiSource(config).listLatestTransactions(5);
    expect(txs[0]?.ironwood).toEqual(bundle);
  });
});

/**
 * A day with no recorded difficulty must arrive as `null` and stay null. A day the index
 * has no difficulty for averages to NULL; coercing that with `Number()` gives 0, which would
 * plot as a measurement at the axis floor. A fabricated zero satisfies every shape check a
 * real value does, so the boundary must keep null as null.
 *
 * The adapter also accepts the older API's `0`: this is a widening, so the frontend can ship
 * first.
 */
describe("a day with no recorded difficulty", () => {
  const day = { timestamp: 1_477_612_800, avgDifficulty: null, avgBlockBytes: 2665.74 };

  it("keeps null as null, never a zero", async () => {
    const fetchMock = stub(200, [day], { "/chain/info": facts });
    vi.stubGlobal("fetch", fetchMock);
    const points = await createChainApiSource(config).getNetworkDaily();
    expect(points[0]?.avgDifficulty).toBeNull();
  });

  it("still accepts a measured difficulty", async () => {
    const fetchMock = stub(200, [{ ...day, avgDifficulty: 60_517_493.4 }], {
      "/chain/info": facts,
    });
    vi.stubGlobal("fetch", fetchMock);
    const points = await createChainApiSource(config).getNetworkDaily();
    expect(points[0]?.avgDifficulty).toBe(60_517_493.4);
  });

  it("rejects an ABSENT key, so version skew stays loud", async () => {
    // `undefined` is not `null`: a missing key means the API is a build behind, and must not
    // render like a genuine gap.
    const withoutDifficulty = Object.fromEntries(
      Object.entries(day).filter(([key]) => key !== "avgDifficulty"),
    );
    const fetchMock = stub(200, [withoutDifficulty], { "/chain/info": facts });
    vi.stubGlobal("fetch", fetchMock);
    await expect(createChainApiSource(config).getNetworkDaily()).rejects.toThrow(/unrecognised/i);
  });

  it("rejects a NaN, which typeof calls a number", async () => {
    // JSON cannot carry NaN, but a wrongly typed value must still be stopped here.
    const fetchMock = stub(200, [{ ...day, avgBlockBytes: "8986.97" }], { "/chain/info": facts });
    vi.stubGlobal("fetch", fetchMock);
    await expect(createChainApiSource(config).getNetworkDaily()).rejects.toThrow(/unrecognised/i);
  });
});

/**
 * Retry on a transient upstream. List routes run without the fetch Data Cache, so a single
 * stall on the frontend→API path would otherwise render an error page. Retrying is narrow —
 * a stall or a 5xx, never a shape — so these tests pin both halves: a blip recovers, and
 * version skew is still loud on the first attempt.
 */
describe("transient upstream retry", () => {
  /** Fails the first `failures` calls to `needle` with `mode`, then succeeds. */
  function flaky(needle: string, failures: number, mode: "stall" | "500", body: unknown) {
    let seen = 0;
    return vi.fn().mockImplementation((url: string) => {
      if (String(url).includes("/chain/info") && !needle.includes("/chain/info")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(facts) });
      }
      if (String(url).includes(needle) && seen < failures) {
        seen += 1;
        if (mode === "500") {
          return Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) });
        }
        const err = new Error("The operation was aborted due to timeout");
        err.name = "TimeoutError";
        return Promise.reject(err);
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    });
  }

  it("recovers from a single stall rather than showing the error page", async () => {
    const fetchMock = flaky("/chain/transactions", 1, "stall", {
      items: [tx],
      nextCursor: null,
      prevCursor: null,
    });
    vi.stubGlobal("fetch", fetchMock);
    const page = await createChainApiSource(config).listTransactions({ limit: 25 }, "all");
    expect(page.items).toHaveLength(1);
  });

  it("recovers from a 5xx, which is the upstream failing rather than answering", async () => {
    const fetchMock = flaky("/chain/transactions", 2, "500", {
      items: [tx],
      nextCursor: null,
      prevCursor: null,
    });
    vi.stubGlobal("fetch", fetchMock);
    const page = await createChainApiSource(config).listTransactions({ limit: 25 }, "all");
    expect(page.items).toHaveLength(1);
  });

  it("gives up and REJECTS on a persistent outage — an outage is never data", async () => {
    // The alternative would be an empty list, which reads as "the chain is empty".
    const fetchMock = flaky("/chain/transactions", 99, "stall", {});
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      createChainApiSource(config).listTransactions({ limit: 25 }, "all"),
    ).rejects.toThrow();
  });

  it("does NOT retry a 404: it is an answer, and means the resource is absent", async () => {
    const fetchMock = stub(404, { error: "not found" }, { "/chain/info": facts });
    vi.stubGlobal("fetch", fetchMock);
    expect(await createChainApiSource(config).getTransaction("d".repeat(64))).toBeUndefined();
    const calls = fetchMock.mock.calls.filter(([u]) => String(u).includes("/chain/transactions/"));
    expect(calls).toHaveLength(1);
  });

  it("does NOT retry a bad shape, so version skew stays loud on the first attempt", async () => {
    const fetchMock = stub(200, { items: [{ nope: true }] }, { "/chain/info": facts });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      createChainApiSource(config).listTransactions({ limit: 25 }, "all"),
    ).rejects.toThrow(/unrecognised/i);
    const calls = fetchMock.mock.calls.filter(([u]) => String(u).includes("/chain/transactions"));
    expect(calls).toHaveLength(1);
  });

  it("bounds the attempts, so a stalled upstream cannot be retried forever", async () => {
    // The budget is three attempts of four seconds — a 12 s worst case — so a dead upstream
    // cannot hold a function open indefinitely.
    const fetchMock = flaky("/chain/transactions", 99, "stall", {});
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      createChainApiSource(config).listTransactions({ limit: 25 }, "all"),
    ).rejects.toThrow();
    const calls = fetchMock.mock.calls.filter(([u]) => String(u).includes("/chain/transactions"));
    expect(calls).toHaveLength(3);
  });
});

describe("readSocialPost", () => {
  const dailySnapshot = {
    readAtUnix: 1_788_000_000,
    readAtHeight: 3_464_661,
    parisDay: "2026-08-29",
    priceUsd: 804.63,
    priceChange24hPct: 4.2,
    pools: [],
    circulatingSupplyZat: 10,
    flow24h: null,
    recentCloses: [],
  };

  it("reads the published figures", async () => {
    vi.stubGlobal(
      "fetch",
      stub(
        200,
        {},
        {
          "/chain/social/post/": { eventKey: "2026-08-29", figures: dailySnapshot, tweetId: null },
        },
      ),
    );
    const post = await createChainApiSource(config).readSocialPost("daily", "2026-08-29");
    expect(post?.figures).toEqual(dailySnapshot);
  });

  it("rejects a post without `figures`, the only key the API publishes", async () => {
    vi.stubGlobal(
      "fetch",
      stub(
        200,
        {},
        {
          "/chain/social/post/": { eventKey: "2026-08-29", snapshot: dailySnapshot, tweetId: null },
        },
      ),
    );
    await expect(
      createChainApiSource(config).readSocialPost("daily", "2026-08-29"),
    ).rejects.toThrow(/social post/);
  });
});

/**
 * The two per-pool chart series. A well-formed payload passes through verbatim; anything
 * else throws the version-skew tripwire rather than rendering a blank chart.
 */
describe("pool series adapters", () => {
  const usagePoint = {
    timestamp: 1_700_000_000,
    sproutTxs: 5,
    saplingTxs: 3,
    orchardTxs: 9,
    ironwoodTxs: 0,
  };
  const migrationPoint = {
    timestamp: 1_700_000_000,
    toSproutZat: 0,
    toSaplingZat: 0,
    toOrchardZat: 50,
    toIronwoodZat: 250,
  };

  it("returns the pool usage series", async () => {
    vi.stubGlobal("fetch", stub(200, [usagePoint]));
    const points = await createChainApiSource(config).getPoolUsageSeries();
    expect(points).toEqual([usagePoint]);
  });

  it("rejects an unrecognised pool usage shape", async () => {
    vi.stubGlobal("fetch", stub(200, [{ nonsense: true }]));
    await expect(createChainApiSource(config).getPoolUsageSeries()).rejects.toThrow(
      /unrecognised/i,
    );
  });

  it("returns the pool migration series", async () => {
    vi.stubGlobal("fetch", stub(200, [migrationPoint]));
    const points = await createChainApiSource(config).getPoolMigrationSeries();
    expect(points).toEqual([migrationPoint]);
  });

  it("rejects an unrecognised pool migration shape", async () => {
    // A usage payload answering the migration route is the skew this must catch: both are arrays
    // of numbered pool fields, so a loose shared check would wave it through.
    vi.stubGlobal("fetch", stub(200, [usagePoint]));
    await expect(createChainApiSource(config).getPoolMigrationSeries()).rejects.toThrow(
      /unrecognised/i,
    );
  });
});

describe("circuit breaker — an outage costs milliseconds, not seconds", () => {
  /** Every call fails as a 503. */
  function dead() {
    return vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) }),
      );
  }

  afterEach(() => {
    resetApiBreaker();
    vi.useRealTimers();
  });

  it("after three failed requests the fourth is refused with NO fetch at all", async () => {
    const fetchMock = dead();
    vi.stubGlobal("fetch", fetchMock);
    const source = createChainApiSource(config);
    for (let i = 0; i < 3; i += 1) {
      await expect(source.getChainFacts()).rejects.toThrow();
    }
    const before = fetchMock.mock.calls.length;
    expect(before).toBe(9); // three requests × three attempts, the retry rule intact
    await expect(source.getChainFacts()).rejects.toThrow(/circuit open/);
    expect(fetchMock.mock.calls.length).toBe(before);
  });

  it("the refusal is TRANSIENT, so the page-level DataUnavailable path still catches it", async () => {
    vi.stubGlobal("fetch", dead());
    const source = createChainApiSource(config);
    for (let i = 0; i < 3; i += 1) await source.getChainFacts().catch(() => undefined);
    const err = await source.getChainFacts().catch((e: unknown) => e);
    expect(isTransientUpstream(err)).toBe(true);
  });

  it("lets one probe through after the window, and a recovered API closes it", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-07T07:00:00Z"));
    let alive = false;
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        alive
          ? Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(facts) })
          : Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const source = createChainApiSource(config);
    for (let i = 0; i < 3; i += 1) {
      const p = source.getChainFacts().catch(() => undefined);
      await vi.runAllTimersAsync();
      await p;
    }
    await expect(source.getChainFacts()).rejects.toThrow(/circuit open/);
    alive = true;
    vi.setSystemTime(new Date("2026-09-07T07:00:31Z"));
    const before = fetchMock.mock.calls.length;
    expect((await source.getChainFacts()).height).toBe(facts.height); // the probe
    expect(fetchMock.mock.calls.length).toBe(before + 1);
    expect((await source.getChainFacts()).height).toBe(facts.height); // closed again
  });

  it("a 404 is an ANSWER and never trips the breaker", async () => {
    const fetchMock = stub(404, { error: "not found" }, { "/chain/info": facts });
    vi.stubGlobal("fetch", fetchMock);
    const source = createChainApiSource(config);
    for (let i = 0; i < 5; i += 1) {
      expect(await source.getTransaction("d".repeat(64))).toBeUndefined();
    }
    expect(
      fetchMock.mock.calls.filter(([u]) => String(u).includes("/chain/transactions/")),
    ).toHaveLength(5);
  });
});

/**
 * Next uses the minimum revalidate across every fetch in a route, so a prerendered page's
 * tip reads must carry the page's own window or the page regenerates on the shorter one.
 * The window is therefore a property of the source.
 */
describe("tipRevalidateSeconds", () => {
  const tipPaths: [string, (s: ReturnType<typeof createChainApiSource>) => Promise<unknown>][] = [
    ["/chain/info", (s) => s.getChainFacts()],
    ["/chain/pools", (s) => s.getPools()],
    ["/chain/stats", (s) => s.getStats()],
    ["/chain/stats/series", (s) => s.getPriceSeries()],
    ["/chain/network/peers", (s) => s.getNetworkPeers()],
    ["/chain/pulse/frame", (s) => s.getPulseFrame()],
    ["/chain/pulse/pending", (s) => s.getPulsePending()],
  ];

  it.each(tipPaths)("%s follows the source's configured tip window", async (path, read) => {
    const fetchMock = stub(200, {});
    vi.stubGlobal("fetch", fetchMock);
    await read(createChainApiSource({ ...config, tipRevalidateSeconds: 60 })).catch(() => {});
    expect(initFor(fetchMock, path).next?.revalidate).toBe(60);
  });

  it("defaults to the 15-second tip window when none is configured", async () => {
    const fetchMock = stub(200, facts);
    vi.stubGlobal("fetch", fetchMock);
    await createChainApiSource(config).getChainFacts();
    expect(initFor(fetchMock, "/chain/info").next?.revalidate).toBe(15);
  });

  it("leaves immutable and analytics windows alone", async () => {
    const fetchMock = stub(200, { months: [] });
    vi.stubGlobal("fetch", fetchMock);
    await createChainApiSource({ ...config, tipRevalidateSeconds: 60 })
      .getMonthlySeries()
      .catch(() => {});
    expect(initFor(fetchMock, "/chain/analytics/months").next?.revalidate).toBe(3600);
  });
});
