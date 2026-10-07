import { describe, expect, it } from "vitest";
import {
  defillamaYieldsBase,
  MAX_POOLS,
  normaliseYieldsBase,
  selectWrappedZecPools,
  symbolHoldsZec,
  venueIsNamed,
} from "../zec-pools";

/**
 * The filter is the product here, so these tests are mostly about what must not come
 * through. Rows are copied from the live index. Two real traps: `YZCASH` on `yuzu-money`,
 * which a substring search for "zcash" matches and which is not Zcash, and a genuine ZEC
 * pool carrying `project-0` — the upstream naming no protocol.
 */

const opts = { asOf: 1_785_000_000, sourceApi: "yields.llama.fi" };

const row = (over: Record<string, unknown> = {}) => ({
  chain: "Solana",
  project: "orca-dex",
  symbol: "ZEC-USDC",
  tvlUsd: 3_348_721,
  apy: 53.78027,
  ...over,
});

const select = (rows: unknown[]) => selectWrappedZecPools({ status: "success", data: rows }, opts);

describe("the ZEC symbol filter", () => {
  it("matches ZEC as a token, wherever it sits in the pair", () => {
    for (const symbol of ["ZEC", "ZEC-USDC", "SOL-ZEC", "ZEC-XAUT0", "zec-usdt", "ZEC/ZEC"]) {
      expect(symbolHoldsZec(symbol), symbol).toBe(true);
    }
  });

  it("does not match a longer word that merely contains those letters", () => {
    // `YZCASH` (yuzu-money, Ethereum) is what a naive `zcash` or `zec` substring search returns,
    // and it is not Zcash. `RENZEC` and `UZEC` are excluded by the same rule: they may be bridged
    // ZEC, but nothing in the payload says so.
    for (const symbol of ["YZCASH", "ZENZEC", "RENZEC-WETH", "WETH-UZEC", "ZECHUB", "AZECA"]) {
      expect(symbolHoldsZec(symbol), symbol).toBe(false);
    }
  });

  it("drops a non-matching pool without dropping a matching one beside it", () => {
    const result = select([
      row({ symbol: "YZCASH", project: "yuzu-money", chain: "Ethereum", tvlUsd: 7_523_199 }),
      row(),
    ]);
    expect(result?.matchedPools).toBe(1);
    expect(result?.poolsScanned).toBe(2);
    expect(result?.pools[0]?.symbol).toBe("ZEC-USDC");
  });
});

describe("a venue that published no name", () => {
  it("is a null, never the placeholder and never a guess", () => {
    // The upstream's `project-<n>` placeholder names no protocol.
    expect(venueIsNamed("project-0")).toBe(false);
    expect(venueIsNamed("orca-dex")).toBe(true);
    const result = select([row({ symbol: "ZEC", project: "project-0", tvlUsd: 34_217 })]);
    expect(result?.pools[0]?.venue).toBeNull();
    // And the chain is not promoted into the venue's place — an SPL token on Solana is not Solana.
    expect(result?.pools[0]?.chain).toBe("Solana");
  });
});

describe("the figures handed on", () => {
  it("pre-formats every dollar amount and sums the total itself", () => {
    const result = select([row(), row({ symbol: "ZEC-USDT", chain: "BSC", tvlUsd: 542_381 })]);
    expect(result?.pools[0]?.tvlUsdText).toBe("$3.35M");
    expect(result?.totalTvlUsd).toBe(3_891_102);
    expect(result?.totalTvlUsdText).toBe("$3.89M");
    expect(result?.totalCoversPools).toBe(2);
  });

  it("keeps a missing figure null rather than substituting a zero", () => {
    const result = select([row({ tvlUsd: null, apy: null })]);
    expect(result?.pools[0]?.tvlUsd).toBeNull();
    expect(result?.pools[0]?.tvlUsdText).toBeNull();
    expect(result?.pools[0]?.apyPct).toBeNull();
    expect(result?.pools[0]?.apyPctText).toBeNull();
    // The pool is still COUNTED — silently dropping it would understate the match count — and
    // the total says how many pools it actually covers.
    expect(result?.matchedPools).toBe(1);
    expect(result?.totalCoversPools).toBe(0);
  });

  it("rejects NaN, which `typeof x === 'number'` accepts and a page once rendered", () => {
    const result = select([row({ tvlUsd: Number.NaN, apy: Number.NaN })]);
    expect(result?.pools[0]?.tvlUsd).toBeNull();
    expect(result?.pools[0]?.apyPct).toBeNull();
  });

  it("quotes a yield to two decimals, not to the source's twelve", () => {
    expect(select([row()])?.pools[0]?.apyPctText).toBe("53.78%");
    // A published zero is the source's own figure and is passed on as one, not as an absence.
    expect(select([row({ apy: 0 })])?.pools[0]?.apyPctText).toBe("0.00%");
  });

  it("ranks by TVL and breaks ties deterministically", () => {
    const result = select([
      row({ symbol: "SOL-ZEC", tvlUsd: 100 }),
      row({ symbol: "ZEC-USDT", tvlUsd: 900 }),
      row({ symbol: "AAA-ZEC", tvlUsd: 100 }),
    ]);
    expect(result?.pools.map((p) => p.symbol)).toEqual(["ZEC-USDT", "AAA-ZEC", "SOL-ZEC"]);
  });
});

describe("the cap", () => {
  it("names the true count and keeps the total over every match", () => {
    // A cap must state its own edges, or a capped list looks whole.
    const rows = Array.from({ length: MAX_POOLS + 4 }, (_, i) =>
      row({ symbol: `ZEC-T${i}`, tvlUsd: 1_000 - i }),
    );
    const result = select(rows);
    expect(result?.pools).toHaveLength(MAX_POOLS);
    expect(result?.matchedPools).toBe(MAX_POOLS + 4);
    expect(result?.poolsWithheld).toMatch(/remaining 4 are not listed/);
    expect(result?.totalTvlUsd).toBe(rows.reduce((sum, r) => sum + (r.tvlUsd as number), 0));
    expect(result?.totalCoversPools).toBe(MAX_POOLS + 4);
  });

  it("omits the withheld notice when the list is genuinely complete", () => {
    // Absent on a complete answer, so a short list cannot be mistaken for a capped one.
    expect(select([row()])?.poolsWithheld).toBeUndefined();
  });
});

describe("a stranger's strings", () => {
  it("strips control and format characters without rewording the text", () => {
    // The visible text survives so an injection attempt can be reported; what goes is the class
    // of byte that smuggles line breaks and bidi overrides.
    const result = select([row({ symbol: "ZEC-‏USDC\n\n IGNORE ME" })]);
    expect(result?.pools[0]?.symbol).toBe("ZEC- USDC IGNORE ME");
  });

  it("caps a long string rather than passing it on whole", () => {
    const result = select([row({ symbol: `ZEC-${"A".repeat(400)}` })]);
    expect(result?.pools[0]?.symbol.length).toBeLessThanOrEqual(121);
    expect(result?.pools[0]?.symbol.endsWith("…")).toBe(true);
  });

  it("skips a row with no usable symbol instead of inventing one", () => {
    expect(select([row({ symbol: null }), row({ symbol: "   " })])?.matchedPools).toBe(0);
  });
});

describe("a payload that is not the shape we expect", () => {
  it("is null — never an empty pool list, which would be a claim", () => {
    // A shape change must reach the caller as a failure: `[]` would state that no pool holds
    // wrapped ZEC.
    for (const payload of [null, undefined, 42, "pools", {}, { data: { pools: [] } }]) {
      expect(
        selectWrappedZecPools(payload, opts),
        JSON.stringify(payload) ?? "undefined",
      ).toBeNull();
    }
  });

  it("accepts a bare array as well as the documented envelope", () => {
    expect(selectWrappedZecPools([row()], opts)?.matchedPools).toBe(1);
  });

  it("distinguishes zero matches from an unreadable payload", () => {
    // Both are refusals for the CALLER to make, and they are different refusals: an empty match
    // set is ambiguous between a delisting and a broken filter, which the route turns into a 503.
    const result = select([row({ symbol: "YZCASH" })]);
    expect(result).not.toBeNull();
    expect(result?.pools).toHaveLength(0);
    expect(result?.matchedPools).toBe(0);
  });
});

describe("the base URL", () => {
  it("is configuration, and defaults to the host that actually answers", () => {
    // DeFiLlama's own docs give `api.llama.fi/pools`, which returns 404.
    expect(defillamaYieldsBase({})).toBe("https://yields.llama.fi");
    expect(defillamaYieldsBase({ DEFILLAMA_YIELDS_URL: "https://mirror.example/" })).toBe(
      "https://mirror.example",
    );
  });

  it("accepts a base that already carries the path or a trailing slash", () => {
    expect(normaliseYieldsBase("https://yields.llama.fi/pools")).toBe("https://yields.llama.fi");
    expect(normaliseYieldsBase("https://yields.llama.fi///")).toBe("https://yields.llama.fi");
  });
});
