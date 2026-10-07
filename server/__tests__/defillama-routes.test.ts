import { describe, expect, it } from "vitest";
import { defillamaRoutes, WRAPPED_ZEC_POOLS_PATH } from "../defillama-routes";

/**
 * The route's whole job beyond fetching is to refuse three things: an empty list where a read
 * failed, a cached outage, and a published zero that is ambiguous between a delisting and a
 * broken filter. `fetch` is injected, so none of this reaches the network.
 */

const POOL = {
  chain: "Solana",
  project: "orca-dex",
  symbol: "ZEC-USDC",
  tvlUsd: 3_348_721,
  apy: 53.78027,
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

interface Harness {
  app: ReturnType<typeof defillamaRoutes>;
  calls: () => number;
  urls: string[];
}

function harness(
  responder: (url: string, call: number) => Response | Promise<Response>,
  baseUrl = "https://yields.example",
): Harness {
  let calls = 0;
  const urls: string[] = [];
  const app = defillamaRoutes({
    baseUrl,
    now: () => 1_785_000_000_000,
    fetch: ((input: RequestInfo | URL) => {
      calls += 1;
      const url = String(input);
      urls.push(url);
      return Promise.resolve(responder(url, calls));
    }) as typeof globalThis.fetch,
  });
  return { app, calls: () => calls, urls };
}

const get = (h: Harness) => h.app.request(WRAPPED_ZEC_POOLS_PATH);

describe("the wrapped-ZEC pool route", () => {
  it("serves the filtered snapshot with its provenance and its timestamp", async () => {
    const h = harness(() => jsonResponse({ status: "success", data: [POOL] }));
    const res = await get(h);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.source).toBe("DeFiLlama");
    expect(body.sourceApi).toBe("yields.example");
    // The instant is part of the figure: TVL and APY move continuously, and a snapshot that does
    // not say when it was read invites "currently" to be attached to a half-hour-old number.
    expect(body.asOf).toBe(1_785_000_000);
    expect(body.matchedPools).toBe(1);
    expect(h.urls).toEqual(["https://yields.example/pools"]);
  });

  it("asks the configured host, never a hardcoded one", async () => {
    const h = harness(() => jsonResponse([POOL]), "https://mirror.example/v2");
    await get(h);
    expect(h.urls).toEqual(["https://mirror.example/v2/pools"]);
  });

  it("caches, so one visitor's question does not re-download a 10 MB index", async () => {
    const h = harness(() => jsonResponse([POOL]));
    await get(h);
    await get(h);
    await get(h);
    expect(h.calls()).toBe(1);
  });

  describe("a failed read", () => {
    it("is a 503 naming the upstream, never an empty pool list", async () => {
      // `[]` would state that no pool holds wrapped ZEC — a claim about the world where we only
      // have a report about our plumbing. Same rule as the shielding series.
      const h = harness(() => new Response("upstream down", { status: 502 }));
      const res = await get(h);
      expect(res.status).toBe(503);
      const body = (await res.json()) as { error: { message: string } };
      expect(body.error.message).toMatch(/DeFiLlama pool index unreadable/);
      expect(body.error.message).toMatch(/HTTP 502/);
      expect(JSON.stringify(body)).not.toContain('"pools"');
    });

    it("is a 503 when the body is not JSON at all", async () => {
      const h = harness(() => new Response("<html>502</html>", { status: 200 }));
      expect((await get(h)).status).toBe(503);
    });

    it("is a 503 when the payload is not the shape the parser knows", async () => {
      const h = harness(() => jsonResponse({ status: "success", data: { pools: 3 } }));
      const res = await get(h);
      expect(res.status).toBe(503);
      expect(JSON.stringify(await res.json())).toMatch(/did not answer with a pool array/);
    });

    it("is never cached — the next question tries again", async () => {
      // An in-memory cache that stored a failure would hand every visitor the outage for the
      // next half hour, long after the venue recovered.
      const h = harness((_url, call) =>
        call === 1 ? new Response("down", { status: 503 }) : jsonResponse([POOL]),
      );
      expect((await get(h)).status).toBe(503);
      expect((await get(h)).status).toBe(200);
      expect(h.calls()).toBe(2);
    });
  });

  it("treats zero matches as unreadable, not as 'no pool holds wrapped ZEC'", async () => {
    // The `ok raw=0` ambiguity: a filter that stopped
    // matching and a venue that delisted ZEC look identical from this side, so neither gets
    // published as a figure.
    const h = harness(() =>
      jsonResponse({ status: "success", data: [{ ...POOL, symbol: "YZCASH" }] }),
    );
    const res = await get(h);
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).toMatch(/ambiguous between a delisting/);
  });

  it("is mounted under a prefix the bearer middleware already guards", () => {
    // Not a new `/external/*` prefix: a new prefix is a new thing to remember to protect, which
    // is the failure mode `server/index.ts` names beside its middleware. The path carries the
    // provenance instead.
    expect(WRAPPED_ZEC_POOLS_PATH.startsWith("/chain/")).toBe(true);
    expect(WRAPPED_ZEC_POOLS_PATH).toContain("defillama");
  });
});
