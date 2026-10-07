import { describe, expect, it } from "vitest";
import { GET } from "../api/live/route";
import { parseLivePayload } from "@/data/live-payload";

/**
 * `/api/live` at its HTTP boundary, against the fixture data source: the contract (echo,
 * headers, shape), not the data. Whether the CDN honours `Netlify-Vary` can only be checked
 * against the deployed site; this catches the header being removed.
 */

/** Requests the route and, like a browser, follows one redirect to the canonical URL. */
const call = async (url: string) => {
  const first = await GET(new Request(url));
  const location = first.headers.get("location");
  return first.status === 308 && location ? GET(new Request(location)) : first;
};

describe("one URL per (kind, direction)", () => {
  it("serves the canonical query directly", async () => {
    const res = await GET(new Request("http://localhost/api/live?kind=all&direction=all"));
    expect(res.status).toBe(200);
  });

  it("redirects any other spelling, uncached, before reading anything", async () => {
    for (const url of [
      "http://localhost/api/live",
      "http://localhost/api/live?kind=nonsense",
      "http://localhost/api/live?direction=in&kind=all",
      "http://localhost/api/live?kind=all&direction=all&junk=1",
    ]) {
      const res = await GET(new Request(url));
      expect(res.status, url).toBe(308);
      expect(res.headers.get("cache-control"), url).toBe("no-store");
      expect(new URL(res.headers.get("location")!).search, url).toMatch(
        /^\?kind=\w+&direction=\w+$/,
      );
    }
  });
});

describe("GET /api/live", () => {
  it("echoes the kind it applied", async () => {
    const body = await (await call("http://localhost/api/live?kind=shielded")).json();

    expect(body.kind).toBe("shielded");
  });

  it("echoes 'all' when no kind was asked for", async () => {
    const body = await (await call("http://localhost/api/live")).json();

    expect(body.kind).toBe("all");
  });

  it("echoes the APPLIED kind when the query is unrecognised, not the query", async () => {
    // Unknown kinds degrade to "all", so "all" is echoed. Echoing the raw query would agree
    // with a caller the route had ignored.
    const body = await (await call("http://localhost/api/live?kind=nonsense")).json();

    expect(body.kind).toBe("all");
  });

  it("carries a tip the page can measure ages against", async () => {
    const body = await (await call("http://localhost/api/live")).json();

    expect(typeof body.tip.height).toBe("number");
    expect(typeof body.tip.hash).toBe("string");
    expect(typeof body.tip.lastBlockTimestamp).toBe("number");
  });

  it("returns rows its own client-side parser accepts", async () => {
    // Checked against each other rather than a literal, so a one-sided rename fails.
    const body = await (await call("http://localhost/api/live")).json();

    const parsed = parseLivePayload(body, "all", "all");

    expect(parsed).not.toBeNull();
    expect(parsed!.blocks.length).toBeGreaterThan(0);
    expect(parsed!.transactions.length).toBeGreaterThan(0);
  });

  it("echoes the direction it applied", async () => {
    const body = await (await call("http://localhost/api/live?direction=in")).json();

    expect(body.direction).toBe("in");
  });

  it("echoes 'all' for an unrecognised direction, not the query", async () => {
    const body = await (await call("http://localhost/api/live?direction=sideways")).json();

    expect(body.direction).toBe("all");
  });

  it("actually narrows the transfers to the direction asked for", async () => {
    // The echo proves the route understood the filter; this proves it applied it.
    const body = await (await call("http://localhost/api/live?direction=in")).json();

    expect(body.transfers.length).toBeGreaterThan(0);
    expect(body.transfers.every((t: { direction: string }) => t.direction === "in")).toBe(true);
  });

  it("names both filters in Netlify-Vary, or they share one cached answer", async () => {
    // Netlify keys a shared cache on `__nextDataReq` and `_rsc` only, so a query parameter
    // that changes the answer must be named or one visitor's filtered list reaches everyone.
    const res = await call("http://localhost/api/live?kind=shielded");

    expect(res.headers.get("Netlify-Vary")).toBe("query=kind|direction");
  });

  it("caches briefly and never stale-while-revalidate", async () => {
    // No stale-while-revalidate: the request that triggers a refresh would get the stale copy.
    const cacheControl = (await call("http://localhost/api/live")).headers.get("Cache-Control");

    expect(cacheControl).toContain("s-maxage=5");
    expect(cacheControl).not.toContain("stale-while-revalidate");
  });
});
