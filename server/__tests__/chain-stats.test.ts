import { afterEach, describe, expect, it, vi } from "vitest";
import type { RpcBlock } from "@/data/chain/rpc-types";
import type { HttpNodeRpc } from "../node-rpc";
import {
  PriceTracker,
  Stats24hTracker,
  countKinds,
  entryFeeRateZatPerByte,
  medianZat,
  parseCoingecko,
  summariseMempool,
} from "../chain-stats";
import realBlock from "@/data/chain/__fixtures__/block-3426950.json";

/**
 * The pure pieces are tested directly; the trackers are tested through their public
 * `current()` against fakes. The one rule every case enforces: **absent beats fabricated** —
 * a cold tracker, a stale quote, or an empty mempool must produce null/omission, never a
 * zero that renders as a real figure.
 */

afterEach(() => vi.unstubAllGlobals());

describe("medianZat", () => {
  it("returns null for an empty list — unknown is not zero", () => {
    expect(medianZat([])).toBeNull();
  });

  it("takes the middle of an odd-length list, sorting first", () => {
    expect(medianZat([30_000, 10_000, 20_000])).toBe(20_000);
  });

  it("averages the middle pair of an even-length list", () => {
    expect(medianZat([10_000, 20_000, 30_000, 40_000])).toBe(25_000);
  });
});

describe("summariseMempool", () => {
  it("reports an empty mempool as zero pending with an unknown median", () => {
    expect(summariseMempool({})).toEqual({
      pendingCount: 0,
      totalSizeBytes: 0,
      medianFeeZat: null,
      medianFeeRateZatPerByte: null,
    });
  });

  it("converts decimal-ZEC fees to zatoshis and sums sizes", () => {
    // `fee` is decimal ZEC, the zcashd convention — the one place a decimal is unavoidable.
    const stats = summariseMempool({
      a: { size: 1_000, fee: 0.0001 },
      b: { size: 2_000, fee: 0.0003 },
      c: { size: 500, fee: 0.0002 },
    });
    expect(stats).toEqual({
      pendingCount: 3,
      totalSizeBytes: 3_500,
      medianFeeZat: 20_000,
      // Rates are 10, 15 and 40 zat/B; the median entry is b.
      medianFeeRateZatPerByte: 15,
    });
  });

  it("counts entries without a fee but excludes them from the median", () => {
    const stats = summariseMempool({
      a: { size: 100 },
      b: { size: 200, fee: 0.0001 },
    });
    expect(stats.pendingCount).toBe(2);
    expect(stats.medianFeeZat).toBe(10_000);
    expect(stats.medianFeeRateZatPerByte).toBe(50);
  });
});

describe("entryFeeRateZatPerByte", () => {
  it("divides the zatoshi fee by the byte size", () => {
    // 0.00012 ZEC over 1,780 bytes — a realistic shielded transaction.
    expect(entryFeeRateZatPerByte({ size: 1_780, fee: 0.00012 })).toBeCloseTo(6.742, 3);
  });

  it("is null, not zero, when the fee or size is missing", () => {
    // A rate of 0 would read as "mined for free eventually" — a claim, not a gap.
    expect(entryFeeRateZatPerByte({ size: 500 })).toBeNull();
    expect(entryFeeRateZatPerByte({ fee: 0.0001 })).toBeNull();
    expect(entryFeeRateZatPerByte({ size: 0, fee: 0.0001 })).toBeNull();
  });
});

describe("countKinds", () => {
  it("counts each privacy kind and records the sample size", () => {
    expect(countKinds(["shielded", "shielded", "mixed", "transparent"])).toEqual({
      sampled: 4,
      transparent: 1,
      mixed: 1,
      shielded: 2,
      coinbase: 0,
    });
  });

  it("reports an empty sample as zero sampled, leaving the caller to say null", () => {
    expect(countKinds([])).toEqual({
      sampled: 0,
      transparent: 0,
      mixed: 0,
      shielded: 0,
      coinbase: 0,
    });
  });
});

describe("parseCoingecko", () => {
  it("parses the live response shape", () => {
    // Captured from the real endpoint, not invented.
    const quote = parseCoingecko({ zcash: { usd: 471.5, usd_24h_change: -6.33189529804246 } }, 42);
    expect(quote).toEqual({ usd: 471.5, change24hPct: -6.33189529804246, fetchedAt: 42 });
  });

  it("withholds the 24h change rather than coercing a missing one to 0", () => {
    expect(parseCoingecko({ zcash: { usd: 471.5 } }, 42)).toEqual({
      usd: 471.5,
      change24hPct: null,
      fetchedAt: 42,
    });
  });

  it("returns null for anything unrecognisable rather than a zero price", () => {
    expect(parseCoingecko({}, 0)).toBeNull();
    expect(parseCoingecko({ zcash: { usd: "471" } }, 0)).toBeNull();
    expect(parseCoingecko(null, 0)).toBeNull();
    expect(parseCoingecko({ zcash: { usd: Number.NaN } }, 0)).toBeNull();
  });
});

describe("PriceTracker", () => {
  it("serves a fetched quote, then withholds it once stale", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ zcash: { usd: 500, usd_24h_change: 1.5 } }),
      } as unknown as Response),
    );
    const tracker = new PriceTracker(() => {});
    const stop = tracker.start();
    await vi.waitFor(() => expect(tracker.current()).not.toBeNull());

    expect(tracker.current()?.usd).toBe(500);
    // Eleven minutes later with no successful poll, the quote is withheld — a day-old price
    // shown as live is the exact fabrication this module exists to remove.
    expect(tracker.current(Date.now() + 11 * 60_000)).toBeNull();
    stop();
  });

  it("stays null when the feed returns garbage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ unexpected: true }),
      } as unknown as Response),
    );
    const tracker = new PriceTracker(() => {});
    const stop = tracker.start();
    // Give the first poll a beat to complete; it must not surface a fabricated quote.
    await new Promise((r) => setTimeout(r, 50));
    expect(tracker.current()).toBeNull();
    stop();
  });
});

describe("Stats24hTracker", () => {
  const template = realBlock as unknown as RpcBlock;
  const nowSeconds = Math.floor(Date.now() / 1000);

  /**
   * The real captured block re-stamped: recent heights get fresh timestamps, height 0 gets
   * one older than a day — inside the height window but outside the time window, which is
   * exactly the distinction `current()` must make.
   */
  function fakeRpc(tip: number): HttpNodeRpc {
    return {
      getTipHeight: () => Promise.resolve(tip),
      getBlock: (height: number) =>
        Promise.resolve({
          ...template,
          height,
          time: height === 0 ? nowSeconds - 2 * 86_400 : nowSeconds - (tip - height) * 75,
        }),
    } as unknown as HttpNodeRpc;
  }

  it("reports null until warm — never a partial count", () => {
    const tracker = new Stats24hTracker(fakeRpc(3), () => {});
    expect(tracker.current()).toBeNull();
  });

  /**
   * Short block spacing: a fixed block count covers only part of a day when the block rate rises,
   * so the "24h" window is defined in time, not blocks.
   */
  function timedRpc(tip: number, spacing: number): HttpNodeRpc {
    return {
      getTipHeight: () => Promise.resolve(tip),
      getBlock: (height: number) =>
        Promise.resolve({ ...template, height, time: nowSeconds - (tip - height) * spacing }),
    } as unknown as HttpNodeRpc;
  }

  it("covers a whole day at 25-second blocks, not a fixed block count", async () => {
    const tip = 10_000;
    const tracker = new Stats24hTracker(
      timedRpc(tip, 25),
      () => {},
      () => nowSeconds,
    );
    const stop = tracker.start();
    await vi.waitFor(() => expect(tracker.current()).not.toBeNull(), { timeout: 10_000 });
    // 86,400 / 25 = 3,456 blocks inside the day, plus the tip itself.
    expect(tracker.current(nowSeconds)!.blocks).toBe(3_457);
    stop();
  });

  it("withholds the figures when a day holds more blocks than the walk may take", async () => {
    // One-second blocks: 86,400 in a day, past the 20,000-block ceiling. Absent, not partial.
    const lines: string[] = [];
    const tracker = new Stats24hTracker(
      timedRpc(100_000, 1),
      (m) => lines.push(m),
      () => nowSeconds,
    );
    const stop = tracker.start();
    // Wait for the warm-up to FINISH, so null below means "withheld", not "not warm yet".
    await vi.waitFor(() => expect(lines.some((l) => l.includes("warm:"))).toBe(true), {
      timeout: 10_000,
    });
    expect(tracker.current(nowSeconds)).toBeNull();
    stop();
  });

  it("aggregates the window and computes the fully-shielded share", async () => {
    // Fixture block rollup: 4 transparent, 3 mixed, 1 fully shielded (coinbase excluded).
    const tracker = new Stats24hTracker(fakeRpc(3), () => {});
    const stop = tracker.start();
    await vi.waitFor(() => expect(tracker.current()).not.toBeNull());

    const stats = tracker.current(nowSeconds)!;
    // Heights 1..3 are within 24h; height 0 is two days old and excluded by timestamp.
    expect(stats.blocks).toBe(3);
    expect(stats.txCount24h).toBe(3 * 8);
    // 1 fully shielded of 8 per block: the strict z→z reading, matching the ink grammar.
    expect(stats.fullyShieldedPct24h).toBe(12.5);
    stop();
  });
});
