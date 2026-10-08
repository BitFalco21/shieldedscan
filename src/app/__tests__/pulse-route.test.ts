import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as live } from "../api/pulse/live/route";
import { GET as replay } from "../api/pulse/window/route";
import { parsePulseLive, parsePulseWindow } from "@/data/pulse-payload";
// Statically, so the spies act on the singleton the route holds. A dynamic import after
// `vi.resetModules()` would return a different instance and the spy would apply to nothing.
import { getDataSource } from "@/data";

/**
 * The two `/pulse` route handlers at their HTTP boundary, against the fixture data source:
 * the contract (echo, headers, refusals), not the data. Whether the CDN honours
 * `Netlify-Vary` can only be checked against the deployed site; this catches the header
 * being removed.
 */

const call = (url: string) => replay(new Request(url));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/pulse/live", () => {
  it("echoes its own kind, so a shared cache cannot answer a different question", async () => {
    const body = await (await live()).json();
    expect(body.kind).toBe("pulse-live");
  });

  it("returns a frame its own client-side parser accepts", async () => {
    // Checked against each other rather than a literal, so a one-sided rename fails.
    const parsed = parsePulseLive(await (await live()).json());
    expect(parsed).not.toBeNull();
    expect(parsed!.frame.blocks.length).toBeGreaterThan(0);
    expect(parsed!.frame.stocks.height).toBe(
      parsed!.frame.blocks[parsed!.frame.blocks.length - 1]!.pools.height,
    );
  });

  it("never places an event above the newest block in the frame", async () => {
    // A pulse whose height is past the frame would light a box the frame does not carry, and
    // the boxes are sized from the newest block's own row.
    const parsed = parsePulseLive(await (await live()).json())!;
    const newest = parsed.frame.stocks.height;
    const heights = parsed.frame.blocks
      .flatMap((b) => b.events)
      .map((e) => e.height)
      .filter((h): h is number => h !== null);
    expect(heights.length).toBeGreaterThan(0);
    expect(Math.max(...heights)).toBeLessThanOrEqual(newest);
  });

  it("places an unpaired crossing at venue time, with no block to light", async () => {
    const parsed = parsePulseLive(await (await live()).json())!;
    expect(parsed.frame.swaps.every((s) => s.height === null && s.blockHash === null)).toBe(true);
  });

  it("carries the mempool layer beside the frame rather than inside it", async () => {
    const parsed = parsePulseLive(await (await live()).json())!;
    expect(parsed.pending?.events.every((e) => e.pending === true)).toBe(true);
    expect(parsed.pending?.count).toBe(parsed.pending?.events.length);
  });

  it("degrades an unreadable mempool to `pending: null` without losing the frame", async () => {
    // A cold tracker answers 503 upstream. The pending layer is optional, so its failure must
    // not cost the frame — and `null` is not `{count: 0}`, which would claim an empty mempool.
    vi.spyOn(getDataSource(), "getPulsePending").mockResolvedValue(null);
    const body = await (await live()).json();
    expect(body.pending).toBeNull();
    expect(body.frame.blocks.length).toBeGreaterThan(0);
  });

  it("keeps the frame when the mempool read REJECTS, not only when it 503s", async () => {
    // An adapter rejects on a timeout or 5xx; the frame must survive that too.
    vi.spyOn(getDataSource(), "getPulsePending").mockRejectedValue(new Error("upstream stall"));
    const body = await (await live()).json();
    expect(body.pending).toBeNull();
    expect(body.frame.blocks.length).toBeGreaterThan(0);
  });

  it("caches briefly and never stale-while-revalidate", async () => {
    // No stale-while-revalidate: the request that triggers a refresh would get the stale copy.
    const cacheControl = (await live()).headers.get("Cache-Control");
    expect(cacheControl).toContain("s-maxage=5");
    expect(cacheControl).not.toContain("stale-while-revalidate");
  });

  it("is absent on testnet, where the page itself 404s", async () => {
    vi.stubEnv("NEXT_PUBLIC_NETWORK", "testnet");
    // The flag is read at module load, so the module has to be loaded again after it is set.
    vi.resetModules();
    const { GET } = await import("../api/pulse/live/route");
    expect((await GET()).status).toBe(404);
  });
});

describe("GET /api/pulse/window", () => {
  const from = 1_783_872_000;
  const to = from + 3_600;
  const url = (q: string) => `http://localhost/api/pulse/window${q}`;

  it("echoes the hour it applied and returns rows its parser accepts", async () => {
    vi.spyOn(Date, "now").mockReturnValue(to * 1_000);
    const body = await (await call(url(`?from=${from}&to=${to}`))).json();
    expect(body.applied).toEqual({ fromSeconds: from, toSeconds: to });
    expect(parsePulseWindow(body, from, to)).not.toBeNull();
  });

  it("redirects other spellings of the same hour, uncached, before reading anything", async () => {
    vi.spyOn(Date, "now").mockReturnValue(to * 1_000);
    const spy = vi.spyOn(getDataSource(), "getPulseWindow");
    for (const q of [
      `?from=0${from}&to=${to}`,
      `?to=${to}&from=${from}`,
      `?from=${from}&to=${to}&x=1`,
    ]) {
      const res = await replay(new Request(url(q)));
      expect(res.status, q).toBe(308);
      expect(res.headers.get("cache-control"), q).toBe("no-store");
      expect(res.headers.get("location"), q).toBe(`/api/pulse/window?from=${from}&to=${to}`);
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("refuses to answer at all when the hour is malformed", async () => {
    // A 400 rather than a nearest guess: answering a different window than the URL asked for
    // would animate the wrong hour.
    for (const query of [
      "",
      "?from=&to=3600",
      `?from=${from}`,
      `?to=${to}`,
      "?from=yesterday&to=today",
      `?from=${from + 60}&to=${to + 60}`,
      `?from=${from}&to=${from + 7_200}`,
      `?from=${from}.5&to=${to}`,
    ]) {
      expect((await call(url(query))).status, query).toBe(400);
    }
  });

  it("refuses an hour older than the replay reaches", async () => {
    // The transport scrubs back one day at most; an unbounded `from` would cache and scan any
    // hour in history.
    vi.spyOn(Date, "now").mockReturnValue(to * 1_000);
    const old = from - 2 * 86_400;
    expect((await call(url(`?from=${old}&to=${old + 3_600}`))).status).toBe(400);
  });

  it("names both parameters in Netlify-Vary, or every hour shares one cached answer", async () => {
    vi.spyOn(Date, "now").mockReturnValue(to * 1_000);
    // Netlify keys a shared cache on `__nextDataReq` and `_rsc` only, so a query parameter that
    // changes the answer must be named.
    const res = await call(url(`?from=${from}&to=${to}`));
    expect(res.headers.get("Netlify-Vary")).toBe("query=from|to");
  });

  it("caches a settled hour hard and a recent one briefly", async () => {
    // A settled hour cannot change, so it gets an hour of CDN; an hour within reorg reach gets
    // the live window.
    vi.spyOn(Date, "now").mockReturnValue((to + 3 * 3_600) * 1_000);
    const settled = await call(url(`?from=${from}&to=${to}`));
    expect(settled.headers.get("Cache-Control")).toContain("s-maxage=3600");

    vi.spyOn(Date, "now").mockReturnValue((to + 60) * 1_000);
    const recent = await call(url(`?from=${from}&to=${to}`));
    expect(recent.headers.get("Cache-Control")).toContain("s-maxage=5");
  });

  it("refuses to cache a settled hour our index does not carry", async () => {
    // The settle horizon here is wall-clock time, while the API uses the tip's header time; the
    // gap is an indexer that has not caught up. A real hour holds ~48 blocks (75 s target), so an
    // empty hour is not cached hard.
    vi.spyOn(Date, "now").mockReturnValue((to + 3 * 3_600) * 1_000);
    vi.spyOn(getDataSource(), "getPulseWindow").mockResolvedValue({
      applied: { fromSeconds: from, toSeconds: to },
      blocks: [],
      swaps: [],
    });
    const res = await call(url(`?from=${from}&to=${to}`));
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=5");
  });

  it("never stale-while-revalidate, settled or not", async () => {
    vi.spyOn(Date, "now").mockReturnValue((to + 3 * 3_600) * 1_000);
    const res = await call(url(`?from=${from}&to=${to}`));
    expect(res.headers.get("Cache-Control")).not.toContain("stale-while-revalidate");
  });

  it("is absent on testnet", async () => {
    vi.stubEnv("NEXT_PUBLIC_NETWORK", "testnet");
    vi.resetModules();
    const { GET } = await import("../api/pulse/window/route");
    expect((await GET(new Request(url(`?from=${from}&to=${to}`)))).status).toBe(404);
  });
});
