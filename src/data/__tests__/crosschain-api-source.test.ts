import { resetApiBreaker } from "../api-request";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CrossChainTransfer } from "@/domain";
import { createCrossChainApiSource, resetCrossChainChainListMemo } from "../crosschain-api-source";

const CONFIG = { baseUrl: "https://api.example", token: "secret" };
const source = createCrossChainApiSource(CONFIG);

const TRANSFER: CrossChainTransfer = {
  id: "maya-abc",
  direction: "in",
  protocol: "maya",
  counterpartChain: "BTC",
  counterpartAsset: "BTC",
  counterpartAmount: 0.04,
  counterpartTxHash: "b5af684b9549",
  counterpartIsSynthetic: false,
  counterpartAddress: "bc1quyhjuf32amgcns4ujmxhxxng3avg0482ky4y3e",
  zcashTxid: "87b727072dcb",
  zcashAddress: "t1Mv595nLBUxJxKAfAZAG9RjhibExEErmMf",
  zecAmountZat: 520671671,
  usdValueAtSwap: 2537.1,
  counterpartUsdAtSwap: null,
  venueDepositAddress: null,
  status: "completed",
  timestamp: 1785026662,
};

/** Stubs fetch and records the calls, so tests can assert on url and headers. */
function mockFetch(body: unknown, init: { status?: number } = {}) {
  const calls: Array<[string, RequestInit | undefined]> = [];
  vi.stubGlobal("fetch", async (url: string, requestInit?: RequestInit) => {
    calls.push([url, requestInit]);
    return new Response(JSON.stringify(body), { status: init.status ?? 200 });
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetApiBreaker();
});

describe("listCrossChainTransfers", () => {
  it("sends the bearer token and passes cursors through opaquely", async () => {
    const calls = mockFetch({ items: [TRANSFER], nextCursor: "abc", prevCursor: null });
    await source.listCrossChainTransfers({ limit: 25, before: "cur/sor+token" });

    const call = calls[0];
    if (!call) throw new Error("fetch was not called");
    const [url, init] = call;
    if (!init) throw new Error("fetch was called without init");
    expect(url).toContain("/crosschain/transfers?");
    expect(url).toContain("limit=25");
    expect(url).toContain(`before=${encodeURIComponent("cur/sor+token")}`);
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer secret");
  });

  it("normalises missing cursors to null", async () => {
    mockFetch({ items: [] });
    const page = await source.listCrossChainTransfers({ limit: 25 });
    expect(page).toEqual({ items: [], nextCursor: null, prevCursor: null });
  });

  it("rejects a transient failure rather than resolving empty", async () => {
    // An empty page would read as "no cross-chain activity", which is a lie during an
    // outage. The port requires a rejection so the error boundary renders.
    mockFetch({ error: "bad gateway" }, { status: 502 });
    await expect(source.listCrossChainTransfers({ limit: 25 })).rejects.toThrow(/502/);
  });

  it("rejects a page whose shape it does not recognise", async () => {
    mockFetch({ items: [{ id: "maya-abc" }] });
    await expect(source.listCrossChainTransfers({ limit: 25 })).rejects.toThrow(/page shape/);
  });
});

describe("getCrossChainTransfer", () => {
  it("returns the transfer", async () => {
    mockFetch(TRANSFER);
    await expect(source.getCrossChainTransfer("maya-abc")).resolves.toEqual(TRANSFER);
  });

  it("url-encodes the id", async () => {
    const calls = mockFetch(TRANSFER);
    await source.getCrossChainTransfer("maya-a/b");
    expect(calls[0]?.[0]).toContain("maya-a%2Fb");
  });

  it("maps 404 to undefined — that is the designed not-found path", async () => {
    mockFetch({ error: "not found" }, { status: 404 });
    await expect(source.getCrossChainTransfer("nope")).resolves.toBeUndefined();
  });

  it("rejects on 500 instead of masking an outage as a missing transfer", async () => {
    // Returning undefined here would render a 404 page for a transfer that exists.
    mockFetch({}, { status: 500 });
    await expect(source.getCrossChainTransfer("maya-abc")).rejects.toThrow(/500/);
  });
});

/**
 * The venue filter has to reach the API, not just the page: forwarded when set, omitted
 * when not.
 */
describe("venue filter", () => {
  const page = { items: [TRANSFER], nextCursor: null, prevCursor: null };

  it("forwards the selected venue to the API", async () => {
    const calls = mockFetch(page);
    await source.listCrossChainTransfers({ limit: 25 }, { protocol: "near-intents" });
    expect(calls[0]![0]).toContain("protocol=near-intents");
  });

  it("omits the parameter entirely for 'all', keeping the default request unchanged", async () => {
    // Not `protocol=all`: an unfiltered page must stay byte-identical so it shares one CDN
    // cache key.
    const calls = mockFetch(page);
    await source.listCrossChainTransfers({ limit: 25 }, { protocol: "all" });
    expect(calls[0]![0]).not.toContain("protocol");
  });

  it("omits it when no filter is passed at all", async () => {
    const calls = mockFetch(page);
    await source.listCrossChainTransfers({ limit: 25 });
    expect(calls[0]![0]).not.toContain("protocol");
  });

  it("keeps the cursor alongside the filter, so paging stays filtered", async () => {
    const calls = mockFetch(page);
    await source.listCrossChainTransfers(
      { limit: 25, before: "cursor-token" },
      { protocol: "maya" },
    );
    expect(calls[0]![0]).toContain("before=cursor-token");
    expect(calls[0]![0]).toContain("protocol=maya");
  });
});

describe("chain filters", () => {
  const applied = (
    sourceChains: string[] = [],
    destinationChains: string[] = [],
    minUsdAtSwap: number | null = null,
  ) => ({
    items: [TRANSFER],
    nextCursor: null,
    prevCursor: null,
    applied: { sourceChains, destinationChains, minUsdAtSwap },
  });

  it("forwards each side as a sorted comma list", async () => {
    const calls = mockFetch(applied(["BTC", "ETH"], ["ZEC"]));
    await source.listCrossChainTransfers(
      { limit: 25 },
      { sourceChains: ["ETH", "BTC"], destinationChains: ["ZEC"] },
    );
    const url = decodeURIComponent(calls[0]![0]);
    expect(url).toContain("source=BTC,ETH");
    expect(url).toContain("destination=ZEC");
  });

  it("omits both when nothing is selected, keeping the default request unchanged", async () => {
    const calls = mockFetch(applied());
    await source.listCrossChainTransfers({ limit: 25 }, { sourceChains: [] });
    expect(calls[0]![0]).not.toContain("source");
    expect(calls[0]![0]).not.toContain("destination");
  });

  it("forwards them on the count too, so the totals line counts what the table shows", async () => {
    const calls = mockFetch({ total: 3 });
    await source.countCrossChainTransfers({ sourceChains: ["BTC"], destinationChains: ["ZEC"] });
    const url = decodeURIComponent(calls[0]![0]);
    expect(url).toContain("source=BTC");
    expect(url).toContain("destination=ZEC");
  });

  /*
   * The echo: an unfiltered list is a well-formed list, so only the API stating what it
   * applied can tell a dropped filter from a working one.
   */
  it("rejects a page the API did not filter", async () => {
    mockFetch(applied([], []));
    await expect(
      source.listCrossChainTransfers({ limit: 25 }, { sourceChains: ["BTC"] }),
    ).rejects.toThrow(/applied source=\[\]/);
  });

  it("rejects a page filtered by something other than what was asked", async () => {
    mockFetch(applied(["ETH"]));
    await expect(
      source.listCrossChainTransfers({ limit: 25 }, { sourceChains: ["BTC"] }),
    ).rejects.toThrow(/asking source=\[BTC\]/);
  });

  it("rejects an API too old to echo at all", async () => {
    mockFetch({ items: [TRANSFER], nextCursor: null, prevCursor: null });
    await expect(
      source.listCrossChainTransfers({ limit: 25 }, { destinationChains: ["ZEC"] }),
    ).rejects.toThrow(/cross-chain API applied/);
  });

  it("but lets an UNFILTERED page through without one", async () => {
    // Scoped: an API one deploy behind emits no echo, and failing every unfiltered view over
    // that would turn a partial outage into a total one. A filtered view must fail rather than
    // show rows the reader excluded.
    mockFetch({ items: [TRANSFER], nextCursor: null, prevCursor: null });
    const page = await source.listCrossChainTransfers({ limit: 25 }, { protocol: "maya" });
    expect(page.items).toHaveLength(1);
  });
});

describe("getCrossChainChains", () => {
  const FLOWS = {
    flows: [{ chain: "BTC", direction: "in", transfers: 2, zecAmountZat: 100 }],
    firstAt: 1,
    lastAt: 2,
  };

  beforeEach(() => resetCrossChainChainListMemo());

  it("reads the flows aggregate the menus are built from", async () => {
    const calls = mockFetch(FLOWS);
    expect(await source.getCrossChainChains()).toEqual(FLOWS.flows);
    expect(calls[0]![0]).toContain("/crosschain/flows");
  });

  /*
   * Count the upstream calls. `/cross-chain` is `force-no-store`, so nothing above this
   * caches, and `unstable_cache` refuses to read its cache in such a segment. A caching
   * wrapper can typecheck and render correctly while caching nothing, so the assertion is the
   * hit count.
   */
  it("memoises, so five page views cost one request", async () => {
    const calls = mockFetch(FLOWS);
    for (let i = 0; i < 5; i += 1) await source.getCrossChainChains();
    expect(calls).toHaveLength(1);
  });

  it("de-duplicates concurrent callers into one request", async () => {
    const calls = mockFetch(FLOWS);
    await Promise.all([source.getCrossChainChains(), source.getCrossChainChains()]);
    expect(calls).toHaveLength(1);
  });

  it("rejects rather than returning an empty list, which would be a claim", async () => {
    // `[]` reads as "no chain has ever bridged ZEC". The caller turns a rejection into an
    // absent menu, which says nothing.
    mockFetch({}, { status: 503 });
    await expect(source.getCrossChainChains()).rejects.toThrow(/503/);
  });

  it("serves the last good list through a failed refresh", async () => {
    mockFetch(FLOWS);
    await source.getCrossChainChains();
    // The TTL has not expired, so this is served from the memo without a request: an upstream
    // blip cannot empty a populated menu.
    mockFetch({}, { status: 503 });
    expect(await source.getCrossChainChains()).toEqual(FLOWS.flows);
  });
});

describe("the minimum-value filter", () => {
  const page = (minUsdAtSwap: number | null, extra: Record<string, unknown> = {}) => ({
    items: [TRANSFER],
    nextCursor: null,
    prevCursor: null,
    applied: { sourceChains: [], destinationChains: [], minUsdAtSwap, ...extra },
  });

  it("forwards the threshold", async () => {
    const calls = mockFetch(page(100_000));
    await source.listCrossChainTransfers({ limit: 25 }, { minUsdAtSwap: 100_000 });
    expect(calls[0]![0]).toContain("min=100000");
  });

  it("omits it when none is asked for", async () => {
    const calls = mockFetch(page(null));
    await source.listCrossChainTransfers({ limit: 25 }, {});
    expect(calls[0]![0]).not.toContain("min=");
  });

  it("rejects a page the API did not narrow", async () => {
    mockFetch(page(null));
    await expect(
      source.listCrossChainTransfers({ limit: 25 }, { minUsdAtSwap: 100_000 }),
    ).rejects.toThrow(/min=\[null\]/);
  });

  it("rejects a page narrowed to a DIFFERENT threshold", async () => {
    mockFetch(page(10_000));
    await expect(
      source.listCrossChainTransfers({ limit: 25 }, { minUsdAtSwap: 100_000 }),
    ).rejects.toThrow(/asking .*min=\[100000\]/);
  });

  it("rejects an API too old to know the field, distinguishing absent from null", async () => {
    // An absent key means an API that would silently ignore the threshold; an explicit null
    // means one that understood and was asked for nothing.
    mockFetch({
      items: [TRANSFER],
      nextCursor: null,
      prevCursor: null,
      applied: { sourceChains: [], destinationChains: [] },
    });
    await expect(
      source.listCrossChainTransfers({ limit: 25 }, { minUsdAtSwap: 100_000 }),
    ).rejects.toThrow(/cross-chain API applied/);
  });

  it("lets an unfiltered page through an API that echoes nothing", async () => {
    mockFetch({ items: [TRANSFER], nextCursor: null, prevCursor: null });
    await expect(source.listCrossChainTransfers({ limit: 25 }, {})).resolves.toHaveProperty(
      "items",
    );
  });
});

describe("the flows time window", () => {
  const summary = (extra: Record<string, unknown> = {}) => ({
    flows: [{ chain: "BTC", direction: "in", transfers: 2, zecAmountZat: 100 }],
    firstAt: 1,
    lastAt: 2,
    ...extra,
  });

  it("asks for no window at all when the view is all-time, so ALL keeps one cache key", async () => {
    const calls = mockFetch(summary({ windowDays: null }));
    const result = await source.getCrossChainFlows();
    expect(calls[0]![0]).toBe("https://api.example/crosschain/flows");
    expect(result.windowDays).toBeNull();
  });

  it("sends the window in days", async () => {
    const calls = mockFetch(summary({ windowDays: 30 }));
    expect((await source.getCrossChainFlows(30)).windowDays).toBe(30);
    expect(calls[0]![0]).toContain("days=30");
  });

  /*
   * An API one deploy behind ignores an unknown `?days=` and answers all-time — a well-formed
   * aggregate the page would render under a `30D` chip. Only the echo reveals it.
   */
  it("refuses a response that answered a different window", async () => {
    mockFetch(summary({ windowDays: null }));
    await expect(source.getCrossChainFlows(30)).rejects.toThrow(/ignored the flows window/);
  });

  it("refuses a response with no echo at all — absence is what an older API sends", async () => {
    mockFetch(summary());
    await expect(source.getCrossChainFlows(30)).rejects.toThrow(/ignored the flows window/);
  });

  /*
   * Scoping keeps a bad deploy survivable: an API that has never heard of the parameter still
   * answers the ALL view correctly, so only windowed views degrade.
   */
  it("does not check the echo when no window was asked for", async () => {
    mockFetch(summary());
    await expect(source.getCrossChainFlows()).resolves.toHaveProperty("windowDays", null);
  });
});

/**
 * The previous-window comparison degrades; it never rejects. A missing window renders the
 * wrong period under a confident label and must fail; a missing comparison only costs a
 * column.
 */
describe("the previous-window comparison", () => {
  const base = { flows: [], firstAt: 1, lastAt: 2, windowDays: 30 };

  it("passes a well-formed comparison through", async () => {
    const flows = [{ chain: "BTC", direction: "in", transfers: 1, zecAmountZat: 5 }];
    mockFetch({ ...base, previous: { kind: "flows", flows } });
    expect((await source.getCrossChainFlows(30)).previous).toEqual({ kind: "flows", flows });
  });

  it("passes the refusal through, with the date behind it", async () => {
    mockFetch({ ...base, previous: { kind: "incomplete", recordsBeginAt: 1_743_378_339 } });
    expect((await source.getCrossChainFlows(30)).previous).toEqual({
      kind: "incomplete",
      recordsBeginAt: 1_743_378_339,
    });
  });

  it("degrades to no comparison when the API predates the field", async () => {
    mockFetch(base);
    await expect(source.getCrossChainFlows(30)).resolves.toHaveProperty("previous", {
      kind: "none",
    });
  });

  /*
   * A malformed `incomplete` waved through as object-shaped would be read as `flows` with an
   * undefined array, turning a refusal to compare into a fabricated percentage.
   */
  it("treats a malformed comparison as absent rather than trusting it", async () => {
    for (const previous of [
      { kind: "incomplete" },
      { kind: "flows" },
      { kind: "wat", flows: [] },
      "flows",
      null,
    ]) {
      mockFetch({ ...base, previous });
      expect((await source.getCrossChainFlows(30)).previous).toEqual({ kind: "none" });
    }
  });
});

describe("retries", () => {
  it("makes the same three attempts as the chain adapter before giving up on a 5xx", async () => {
    // Both adapters share one request() and therefore one retry policy.
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls += 1;
      return new Response(calls < 3 ? "" : JSON.stringify({ nonsense: true }), {
        status: calls < 3 ? 502 : 200,
      });
    });
    const source = createCrossChainApiSource({ baseUrl: "https://api.example", token: "t" });
    await expect(source.getCrossChainFlows()).rejects.toThrow(/shape/);
    expect(calls).toBe(3);
  });
});

describe("listCrossChainTransfersForZcashTx", () => {
  const TXID = "ab".repeat(32);

  it("asks the by-zcash-tx route for the lowercased txid and returns its transfers", async () => {
    const calls = mockFetch({ zcashTxid: TXID, total: 1, transfers: [TRANSFER] });
    await expect(source.listCrossChainTransfersForZcashTx(TXID.toUpperCase())).resolves.toEqual({
      transfers: [TRANSFER],
      total: 1,
    });
    expect(calls[0]?.[0]).toBe(`https://api.example/crosschain/transfers/by-zcash-tx/${TXID}`);
  });

  it("returns [] for a transaction that crossed nothing — an answer, not a failure", async () => {
    mockFetch({ zcashTxid: TXID, total: 0, transfers: [] });
    await expect(source.listCrossChainTransfersForZcashTx(TXID)).resolves.toEqual({
      transfers: [],
      total: 0,
    });
  });

  it("refuses an answer about a different transaction", async () => {
    // A route that ignored the parameter would answer with a well-formed list about some other
    // txid, and the page would link a stranger's swap.
    mockFetch({ zcashTxid: "cd".repeat(32), total: 1, transfers: [TRANSFER] });
    await expect(source.listCrossChainTransfersForZcashTx(TXID)).rejects.toThrow(/different/);
  });

  it("rejects a missing echo too — absence is what an older route would send", async () => {
    mockFetch({ total: 1, transfers: [TRANSFER] });
    await expect(source.listCrossChainTransfersForZcashTx(TXID)).rejects.toThrow(/different/);
  });

  it("refuses a list with no usable total — a capped list is only honest beside its count", async () => {
    mockFetch({ zcashTxid: TXID, transfers: [TRANSFER] });
    await expect(source.listCrossChainTransfersForZcashTx(TXID)).rejects.toThrow(/total/);
    mockFetch({ zcashTxid: TXID, total: 0, transfers: [TRANSFER] });
    await expect(source.listCrossChainTransfersForZcashTx(TXID)).rejects.toThrow(/total/);
  });

  it("rejects a 404 loudly: it means the route is missing, not that nothing crossed", async () => {
    mockFetch({ error: "not found" }, { status: 404 });
    await expect(source.listCrossChainTransfersForZcashTx(TXID)).rejects.toThrow(/404/);
  });

  it("classifies a 5xx as transient, so the page can drop the strip and keep the page", async () => {
    const { isTransientUpstream } = await import("@/lib/transient-upstream");
    mockFetch({}, { status: 503 });
    const error = await source.listCrossChainTransfersForZcashTx(TXID).catch((e: unknown) => e);
    expect(isTransientUpstream(error)).toBe(true);
  });
});
