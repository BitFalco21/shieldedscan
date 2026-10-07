import { describe, expect, it, vi } from "vitest";
import { decodeCursor } from "@/data/cursor";
import { MemoryStorePort } from "../crosschain-store";
import {
  ParamError,
  parseAtParam,
  parseDayWindow,
  parseOptionalDayEdges,
  parsePoolParam,
  rejectUnknown,
} from "../v1/params";
import { v1Routes, type V1ChainPort } from "../v1/routes";
import type { BlockRowsReader } from "../block-list";
import type { ChainIndexStore } from "../chain-index-store";

/**
 * The narrowing parameters (`pool`, `from`/`to` on the transaction lists and `at` on the block
 * list) at the HTTP boundary: parsed strictly, forwarded to the store (a filter the server drops
 * looks exactly like one that worked), and echoed.
 */

const DAY = 86_400;

describe("the parameter parsers", () => {
  it("names what an endpoint accepts, saying none when it takes no parameters", () => {
    expect(() => rejectUnknown({ x: "1" }, [])).toThrow(
      "unknown parameter: x; this endpoint accepts none",
    );
    expect(() => rejectUnknown({ x: "1", y: "2" }, ["from", "to"])).toThrow(
      "unknown parameters: x, y; this endpoint accepts from, to",
    );
    expect(() => rejectUnknown({ from: "2026-01-01" }, ["from", "to"])).not.toThrow();
  });

  it("reads a pool name or refuses it by name", () => {
    expect(parsePoolParam(undefined)).toBeUndefined();
    expect(parsePoolParam("Orchard")).toBe("orchard");
    expect(() => parsePoolParam("transparent")).toThrow(ParamError);
    expect(() => parsePoolParam("transparent")).toThrow(/ironwood/);
  });

  it("reads a half-open window of real UTC days", () => {
    expect(parseDayWindow("2024-05-28", "2024-05-29")).toEqual({
      fromTs: Date.UTC(2024, 4, 28) / 1000,
      toTs: Date.UTC(2024, 4, 29) / 1000,
    });
    expect(parseDayWindow(undefined, "2024-05-29")).toEqual({ toTs: Date.UTC(2024, 4, 29) / 1000 });
    // `Date.parse` rolls 2026-02-31 into March; a real day is required.
    expect(() => parseDayWindow("2026-02-31", undefined)).toThrow(ParamError);
    expect(() => parseDayWindow("2024-05-29", "2024-05-29")).toThrow(ParamError);
  });

  it("reads optional window edges, refusing a day that does not exist", () => {
    expect(parseOptionalDayEdges({})).toEqual({ fromTs: null, toTs: null });
    expect(parseOptionalDayEdges({ from: "2024-05-28", to: "" })).toEqual({
      fromTs: Date.UTC(2024, 4, 28) / 1000,
      toTs: null,
    });
    expect(() => parseOptionalDayEdges({ to: "2026-02-31" })).toThrow(
      "to must be a UTC day: YYYY-MM-DD",
    );
    expect(() => parseOptionalDayEdges({ from: "2024-05-29", to: "2024-05-29" })).toThrow(
      "to must be a later day than from (to is exclusive)",
    );
  });

  it("reads an instant; a bare day means the end of that day", () => {
    expect(parseAtParam("2024-05-28")).toBe(Date.UTC(2024, 4, 28) / 1000 + DAY - 1);
    expect(parseAtParam("2024-05-28T12:30:00Z")).toBe(Date.UTC(2024, 4, 28, 12, 30) / 1000);
    expect(parseAtParam("2024-05-28T12:30Z")).toBe(Date.UTC(2024, 4, 28, 12, 30) / 1000);
    expect(parseAtParam("1716940800")).toBe(1716940800);
    for (const bad of ["2026-02-31", "2024-05-28T24:00:00Z", "yesterday", "2024-05-28T12:00"]) {
      expect(parseAtParam(bad), bad).toBeNull();
    }
  });
});

function chain(over: Partial<V1ChainPort> = {}): V1ChainPort {
  return {
    getBlock: async (id: string) =>
      id === "102" ? ({ height: 102, hash: "ab".repeat(32) } as never) : undefined,
    ...over,
  } as unknown as V1ChainPort;
}

const empty = { items: [], nextCursor: null, prevCursor: null };

function app(
  chainPort: V1ChainPort,
  index: Partial<ChainIndexStore>,
  // The block list itself is `block-list.ts`'s, tested there; here only what the route asks it.
  blockRows: BlockRowsReader = vi.fn(async () => ({ ...empty, feesStated: true })),
) {
  return v1Routes({
    chain: chainPort,
    store: new MemoryStorePort(),
    enabledProtocols: {},
    chainIndex: index as unknown as ChainIndexStore,
    blockRows,
  });
}

describe("/v1/transactions narrowing", () => {
  it("forwards pool and window to the store and echoes what it applied", async () => {
    const list = vi.fn(async () => empty);
    const res = await app(chain(), { listChainTransactions: list }).request(
      "/v1/transactions?kind=shielded&pool=orchard&from=2024-05-01&to=2024-06-01",
    );
    expect(res.status).toBe(200);
    expect(list).toHaveBeenCalledWith(
      "shielded",
      expect.objectContaining({ limit: expect.any(Number) }),
      { pool: "orchard", fromTs: Date.UTC(2024, 4, 1) / 1000, toTs: Date.UTC(2024, 5, 1) / 1000 },
    );
    expect((await res.json()).filters).toEqual({
      kind: "shielded",
      pool: "orchard",
      from: "2024-05-01",
      to: "2024-06-01",
    });
  });

  it("sends no narrowing at all when none is asked for", async () => {
    const list = vi.fn(async () => empty);
    await app(chain(), { listChainTransactions: list }).request("/v1/transactions");
    expect(list).toHaveBeenCalledWith("all", expect.anything(), {});
  });

  it("refuses an unknown pool, a pool on transparent, and an impossible window", async () => {
    const list = vi.fn(async () => empty);
    const a = app(chain(), { listChainTransactions: list });
    for (const q of [
      "pool=transparent",
      "kind=transparent&pool=sapling",
      "from=2026-02-31",
      "from=2024-06-01&to=2024-05-01",
    ]) {
      const res = await a.request(`/v1/transactions?${q}`);
      expect(res.status, q).toBe(400);
      expect((await res.json()).error.code, q).toBe("invalid_parameter");
    }
    expect(list).not.toHaveBeenCalled();
  });
});

describe("/v1/blocks/{id}/transactions narrowing", () => {
  it("forwards the pool", async () => {
    const list = vi.fn(async () => empty);
    const res = await app(chain(), { listBlockTransactions: list }).request(
      "/v1/blocks/102/transactions?pool=ironwood",
    );
    expect(res.status).toBe(200);
    expect(list).toHaveBeenCalledWith(102, expect.anything(), { pool: "ironwood" });
  });
});

describe("/v1/blocks?at=", () => {
  it("starts the page at the newest block at or before the instant", async () => {
    const heightAtOrBefore = vi.fn(async () => 2_512_345);
    const blockRows = vi.fn(async () => ({ ...empty, feesStated: true }));
    const res = await app(chain(), { heightAtOrBefore }, blockRows).request(
      "/v1/blocks?at=2024-05-28&limit=5",
    );
    expect(res.status).toBe(200);
    const endOfDay = Date.UTC(2024, 4, 28) / 1000 + DAY - 1;
    expect(heightAtOrBefore).toHaveBeenCalledWith(endOfDay);
    const sent = (blockRows.mock.calls[0] as unknown as [{ before: string; limit: number }])[0];
    // A `before` cursor one above the resolved height, so that height is the first row.
    expect(decodeCursor(sent.before)?.sortKey).toBe(String(2_512_346));
    expect(sent.limit).toBe(5);
    expect((await res.json()).at).toEqual({ time: endOfDay, height: 2_512_345 });
  });

  it("answers an empty page, not the newest blocks, for an instant before genesis", async () => {
    const blockRows = vi.fn(async () => ({ ...empty, feesStated: true }));
    const res = await app(chain(), { heightAtOrBefore: async () => null }, blockRows).request(
      "/v1/blocks?at=2010-01-01",
    );
    const body = await res.json();
    expect(body.items).toEqual([]);
    expect(body.at.height).toBeNull();
    expect(blockRows).not.toHaveBeenCalled();
  });

  it("refuses an unreadable instant and a cursor beside it", async () => {
    const a = app(chain(), { heightAtOrBefore: async () => 1 });
    expect((await a.request("/v1/blocks?at=yesterday")).status).toBe(400);
    expect((await a.request("/v1/blocks?at=2024-05-28&cursor=abc")).status).toBe(400);
  });
});

describe("/v1/addresses/{address} — first and last activity, unified receivers", () => {
  const ADDR = "t1a7HnBdsBSvkGZQXD5vPYqoWRvnpG555Jy";
  const balance = {
    getAddressBalance: async () => ({
      kind: "transparent" as const,
      address: ADDR,
      balanceZat: 7,
      totalReceivedZat: 10,
      totalSentZat: 3,
    }),
  };

  it("states when the address first and last appears, from the index", async () => {
    const res = await app(chain(balance), {
      addressActivityExtent: async () => ({
        first: { height: 100, timestamp: 1_500_000_000 },
        last: { height: 3_500_000, timestamp: 1_790_000_000 },
      }),
    }).request(`/v1/addresses/${ADDR}`);
    const body = await res.json();
    expect(body.firstSeen).toEqual({ height: 100, timestamp: 1_500_000_000 });
    expect(body.lastSeen).toEqual({ height: 3_500_000, timestamp: 1_790_000_000 });
    expect(body.unknowns?.firstSeen).toBeUndefined();
  });

  it("says unmeasured, never absent, when the index cannot answer", async () => {
    const res = await app(chain(balance), {
      addressActivityExtent: async () => {
        throw new Error("timeout exceeded when trying to connect");
      },
    }).request(`/v1/addresses/${ADDR}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.firstSeen).toBeNull();
    expect(body.unknowns).toMatchObject({ firstSeen: "unmeasured", lastSeen: "unmeasured" });
  });

  it("lists a unified address's receivers, Orchard's address null with its reason", async () => {
    const { DONATION_ADDRESS } = await import("@/lib/donation");
    const res = await app(chain(), {}).request(`/v1/addresses/${DONATION_ADDRESS}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kind).toBe("unified");
    expect(body.network).toBe("mainnet");
    const types = body.receivers.map((r: { type: string }) => r.type);
    expect(types).toContain("orchard");
    const orchard = body.receivers.findIndex((r: { type: string }) => r.type === "orchard");
    expect(body.receivers[orchard].address).toBeNull();
    expect(body.unknowns[`receivers.${orchard}.address`]).toBe("nonexistent");
    for (const r of body.receivers.filter((x: { type: string }) => x.type === "sapling")) {
      expect(r.address).toMatch(/^zs1/);
    }
    // Still no balance key: a shielded address has nothing to look up.
    expect(body).not.toHaveProperty("balanceZat");
  });
});

describe("/v1/prices/daily?currency=", () => {
  const rows = [
    { day: "2024-06-01", usd: 40, source: "yahoo" },
    { day: "2024-06-02", usd: 50, source: "yahoo" },
  ];
  const rates: Record<string, number> = { "2024-06-01": 0.9, "2024-06-02": 0.92 };
  const date = (d: string) => new Date(`${d}T00:00:00Z`);
  const pool = {
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.includes("DISTINCT currency")) {
        return { rows: [{ currency: "btc" }, { currency: "eur" }] };
      }
      if (sql.includes("FROM fx_rate_daily") && sql.includes("rate_day")) {
        return {
          rows: Object.entries(rates).map(([d, rate]) => ({
            day: date(d),
            rate,
            rate_day: date(d),
          })),
        };
      }
      if (sql.includes("p.usd * f.rate")) {
        return {
          rows: [
            {
              kind: "high",
              day: date("2016-10-29"),
              usd: 2239.29,
              close: 2016.5,
              source: "coincodex",
            },
            { kind: "low", day: date("2019-01-02"), usd: 24.5, close: 21.4, source: "yahoo" },
          ],
        };
      }
      if (sql.includes("AS kind")) return { rows: [] };
      if (sql.includes("min(day)")) {
        return { rows: [{ from: date("2016-10-29"), to: date("2024-06-02") }] };
      }
      void params;
      return { rows: rows.map((r) => ({ day: date(r.day), usd: r.usd, source: r.source })) };
    },
  };
  const app = () =>
    v1Routes({ store: new MemoryStorePort(), enabledProtocols: {}, pool: pool as never });

  it("prices each day in the asked currency at that day's rate, and says which currency", async () => {
    const body = await (await app().request("/v1/prices/daily?currency=EUR")).json();
    expect(body.currency).toBe("eur");
    expect(body.items).toEqual([
      { day: "2024-06-01", usd: 40, source: "yahoo", close: 36, rateDay: "2024-06-01" },
      { day: "2024-06-02", usd: 50, source: "yahoo", close: 46, rateDay: "2024-06-02" },
    ]);
    expect(body.allTimeHigh).toEqual({
      day: "2016-10-29",
      usd: 2239.29,
      close: 2016.5,
      source: "coincodex",
    });
  });

  it("refuses a currency it holds no rates for, naming the ones it does", async () => {
    const res = await app().request("/v1/prices/daily?currency=xyz");
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toBe("currency must be one of usd, btc, eur");
  });

  it("is a 503 when the currency list cannot be read, never a 400 blaming the caller", async () => {
    const down = {
      query: async (sql: string) => {
        if (sql.includes("DISTINCT currency")) throw new Error("connect ECONNREFUSED");
        return { rows: [] };
      },
    };
    const res = await v1Routes({
      store: new MemoryStorePort(),
      enabledProtocols: {},
      pool: down as never,
    }).request("/v1/prices/daily?currency=eur");
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("upstream_unavailable");
  });

  it("is unchanged for USD", async () => {
    const body = await (await app().request("/v1/prices/daily")).json();
    expect(body.currency).toBe("usd");
    expect(body.items[0]).toEqual({ day: "2024-06-01", usd: 40, source: "yahoo" });
  });
});

describe("/v1/transactions/{txid} — summary and swap legs", () => {
  const TXID = "ab".repeat(32);
  const migration = {
    txid: TXID,
    blockHeight: 3_428_150,
    blockHash: "cd".repeat(32),
    timestamp: 1_785_000_000,
    isCoinbase: false,
    version: 6,
    sizeBytes: 9000,
    lockTime: 0,
    expiryHeight: null,
    rawHex: null,
    feeZat: 30_000,
    bindingSigValid: true,
    transparentInputs: [],
    transparentOutputs: [],
    sprout: null,
    sapling: null,
    // Domain sign: a pool's balance is what it GAINED, so Orchard lost and Ironwood gained.
    orchard: { actions: 2, valueBalanceZat: -209_951_630_000 },
    ironwood: { actions: 2, valueBalanceZat: 209_951_600_000 },
  };
  const appWithStore = (byZcashTxid: (txid: string) => Promise<unknown>) => {
    const store = new MemoryStorePort();
    (store as unknown as { byZcashTxid: typeof byZcashTxid }).byZcashTxid = byZcashTxid;
    return v1Routes({
      chain: chain({ getTransaction: async () => undefined }),
      store,
      enabledProtocols: {},
      chainIndex: { getTransaction: async () => migration } as unknown as ChainIndexStore,
    });
  };

  it("states what the transaction did in the site's words, and what the chain does not record", async () => {
    const body = await (
      await appWithStore(async () => ({ total: 0, transfers: [] })).request(
        `/v1/transactions/${TXID}`,
      )
    ).json();
    expect(body.summary.text).toBe("Migrated 2,099.516 ZEC from Orchard into Ironwood.");
    expect(body.summary.notOnChain).toMatch(/Who moved it/);
    expect(body.summary.text).not.toMatch(/sent .* to/);
    // Not a swap leg on any indexed protocol: an answer, not a gap.
    expect(body.crosschain).toEqual({ total: 0, transfers: [] });
    expect(body.unknowns?.crosschain).toBeUndefined();
  });

  it("says unmeasured, never 'not a swap', when the swap store cannot answer", async () => {
    const body = await (
      await appWithStore(async () => {
        throw new Error("connection refused");
      }).request(`/v1/transactions/${TXID}`)
    ).json();
    expect(body.crosschain).toBeNull();
    expect(body.unknowns.crosschain).toBe("unmeasured");
  });
});
