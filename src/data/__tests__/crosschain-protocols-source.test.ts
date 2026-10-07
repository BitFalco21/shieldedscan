import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CrossChainAggregate, CrossChainProtocol } from "@/domain";
import { resetApiBreaker } from "../api-request";
import { createCrossChainApiSource, resetCrossChainProtocolMemo } from "../crosschain-api-source";

const CONFIG = { baseUrl: "https://api.example", token: "secret" };
const source = createCrossChainApiSource(CONFIG);

/** 2026-10-02 12:00 UTC, so a 30-day window starts at 2026-09-03 00:00 UTC. */
const NOW_MS = Date.UTC(2026, 9, 2, 12);
const START_30D = Date.UTC(2026, 8, 3) / 1_000;

const side = (transfers: number, zec: number, usd = zec * 400, covered = transfers) => ({
  transfers,
  zecAmountZat: zec * 1e8,
  usdAtSwap: usd,
  usdCoveredTransfers: covered,
});

function aggregate(
  protocol: CrossChainProtocol,
  fromTimestamp: number | undefined,
  zec: number,
): CrossChainAggregate {
  return {
    groupBy: "chain",
    totals: { in: side(2, zec / 2), out: side(1, zec / 2) },
    groups: [{ key: "BTC", in: side(2, zec / 2), out: side(1, zec / 2) }],
    applied: {
      protocol,
      direction: "all",
      sourceChains: [],
      destinationChains: [],
      counterpartChains: [],
      ...(fromTimestamp === undefined ? {} : { fromTimestamp }),
    },
    firstAt: 1_750_000_000,
    lastAt: 1_790_000_000,
  };
}

const ZEC: Record<CrossChainProtocol, number> = { "near-intents": 900, maya: 90, thorchain: 1 };

type Override = (url: URL) => unknown;

/**
 * A routed stub: answers each protocol's aggregate and top read the way a correct API would,
 * unless a test overrides the answer for one URL. Records every URL so a test can count reads.
 */
function stubApi(override?: Override) {
  const urls: string[] = [];
  vi.stubGlobal("fetch", async (raw: string) => {
    urls.push(raw);
    const url = new URL(raw);
    const custom = override?.(url);
    if (custom !== undefined) return new Response(JSON.stringify(custom));
    const protocol = url.searchParams.get("protocol") as CrossChainProtocol;
    const from = url.searchParams.get("from");
    const fromTs = from === null ? undefined : Date.parse(`${from}T00:00:00Z`) / 1_000;
    if (url.pathname === "/crosschain/aggregate") {
      return new Response(JSON.stringify(aggregate(protocol, fromTs, ZEC[protocol])));
    }
    if (url.pathname === "/v1/crosschain/transfers/top") {
      return new Response(
        JSON.stringify({
          items: [
            {
              id: `${protocol}-top`,
              protocol,
              direction: "in",
              timestamp: (fromTs ?? 1_760_000_000) + 60,
              zecAmountZat: 12_345_000_000,
              legs: { zcash: { usdAtSwap: 5_000 }, counterpart: { chain: "BTC" } },
            },
          ],
        }),
      );
    }
    return new Response("{}", { status: 404 });
  });
  return urls;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW_MS);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetApiBreaker();
  resetCrossChainProtocolMemo();
});

describe("getCrossChainProtocols", () => {
  it("returns every protocol, largest first, with its largest swap", async () => {
    stubApi();
    const summary = await source.getCrossChainProtocols();
    expect(summary.protocols.map((v) => v.protocol)).toEqual(["near-intents", "maya", "thorchain"]);
    expect(summary.windowStart).toBeNull();
    const near = summary.protocols[0]!;
    expect(near.in.transfers + near.out.transfers).toBe(3);
    expect(near.largest).toMatchObject({ id: "near-intents-top", counterpartChain: "BTC" });
  });

  it("asks for the window as a UTC day and also reads each protocol's all-time span", async () => {
    const urls = stubApi();
    const summary = await source.getCrossChainProtocols(30);
    expect(summary.windowStart).toBe(START_30D);
    const windowed = urls.filter((u) => u.includes("groupBy=chain"));
    expect(windowed).toHaveLength(3);
    expect(windowed.every((u) => u.includes("from=2026-09-03"))).toBe(true);
    // The first/last-seen dates are protocol facts, so they come from an UNWINDOWED read.
    const allTime = urls.filter((u) => u.includes("groupBy=none"));
    expect(allTime).toHaveLength(3);
    expect(allTime.some((u) => u.includes("from="))).toBe(false);
  });

  it("does not read the all-time span twice when the window already is all-time", async () => {
    const urls = stubApi();
    await source.getCrossChainProtocols();
    expect(urls.filter((u) => u.includes("groupBy=none"))).toHaveLength(0);
  });

  /*
   * The two echoes the adapter checks. Each failure is a well-formed aggregate describing the
   * wrong thing — every protocol's totals under one name, or all-time under a 30D chip.
   */
  it("refuses an aggregate that dropped the protocol narrowing", async () => {
    stubApi((url) =>
      url.pathname === "/crosschain/aggregate" && url.searchParams.get("protocol") === "maya"
        ? { ...aggregate("maya", undefined, 1), applied: { protocol: "all" } }
        : undefined,
    );
    await expect(source.getCrossChainProtocols()).rejects.toThrow(/ignored the protocol narrowing/);
  });

  it("refuses an aggregate that dropped the window", async () => {
    stubApi((url) =>
      url.pathname === "/crosschain/aggregate" && url.searchParams.get("groupBy") === "chain"
        ? aggregate(url.searchParams.get("protocol") as CrossChainProtocol, undefined, 1)
        : undefined,
    );
    await expect(source.getCrossChainProtocols(30)).rejects.toThrow(/ignored the window/);
  });

  /*
   * The largest swap is the one cell allowed to fail alone — but failing must read as
   * unmeasured, never as "no swaps", and a row from another protocol must never be stated as this
   * protocol's record.
   */
  it("marks the largest swap unavailable when its row belongs to another protocol", async () => {
    stubApi((url) =>
      url.pathname === "/v1/crosschain/transfers/top" && url.searchParams.get("protocol") === "maya"
        ? {
            items: [
              {
                id: "near-x",
                protocol: "near-intents",
                direction: "in",
                timestamp: 1_760_000_000,
                zecAmountZat: 1,
                legs: { zcash: {}, counterpart: { chain: "ETH" } },
              },
            ],
          }
        : undefined,
    );
    const maya = (await source.getCrossChainProtocols()).protocols.find(
      (v) => v.protocol === "maya",
    );
    expect(maya?.largest).toBe("unavailable");
  });

  it("marks the largest swap unavailable when the row predates the window", async () => {
    stubApi((url) =>
      url.pathname === "/v1/crosschain/transfers/top" && url.searchParams.get("protocol") === "maya"
        ? {
            items: [
              {
                id: "maya-old",
                protocol: "maya",
                direction: "in",
                timestamp: START_30D - 1,
                zecAmountZat: 1,
                legs: { zcash: {}, counterpart: { chain: "ETH" } },
              },
            ],
          }
        : undefined,
    );
    const maya = (await source.getCrossChainProtocols(30)).protocols.find(
      (v) => v.protocol === "maya",
    );
    expect(maya?.largest).toBe("unavailable");
  });

  it("reports an empty ranking as no largest swap, which is a measurement", async () => {
    stubApi((url) => (url.pathname === "/v1/crosschain/transfers/top" ? { items: [] } : undefined));
    const summary = await source.getCrossChainProtocols();
    expect(summary.protocols.every((v) => v.largest === null)).toBe(true);
  });

  it("serves a repeat view from the one-minute memo, and re-reads after it", async () => {
    const urls = stubApi();
    await source.getCrossChainProtocols(30);
    const first = urls.length;
    await source.getCrossChainProtocols(30);
    expect(urls.length).toBe(first);
    vi.setSystemTime(NOW_MS + 61_000);
    await source.getCrossChainProtocols(30);
    expect(urls.length).toBe(first * 2);
  });

  it("never stores a failure", async () => {
    let fail = true;
    stubApi((url) =>
      fail && url.pathname === "/crosschain/aggregate" ? { nonsense: true } : undefined,
    );
    await expect(source.getCrossChainProtocols()).rejects.toThrow();
    fail = false;
    await expect(source.getCrossChainProtocols()).resolves.toHaveProperty("protocols");
  });
});
