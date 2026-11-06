import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The guard that stops a public deployment serving fixtures. Nothing on screen distinguishes
 * fixture data from chain data, so a dropped environment variable in production would render
 * sample rows as the chain; the build must fail instead.
 *
 * `isPublicStage` is read at module load, so each case re-imports with a fresh registry.
 */
async function loadDataModule(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) vi.stubEnv(key, "");
    else vi.stubEnv(key, value);
  }
  return import("../index");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

/** Both adapters read this one pair through `readApiConfig`. */
const LIVE = {
  NEXT_PUBLIC_STAGE: "public",
  CROSSCHAIN_API_URL: "https://api.example",
  EXPLORER_API_TOKEN: "tkn",
};

describe("public-stage fixture guard", () => {
  it("refuses to build the public site with the URL missing", async () => {
    await expect(loadDataModule({ ...LIVE, CROSSCHAIN_API_URL: undefined })).rejects.toThrow(
      /Refusing to build the public site on fixtures/,
    );
  });

  it("refuses with the token missing — the URL alone still yields fixtures", async () => {
    await expect(loadDataModule({ ...LIVE, EXPLORER_API_TOKEN: undefined })).rejects.toThrow(
      /Refusing to build the public site on fixtures/,
    );
  });

  it("names variables that actually exist, and the escape hatch", async () => {
    // The error must name the variable that actually exists: both adapters share
    // CROSSCHAIN_API_URL.
    const err = await loadDataModule({ ...LIVE, CROSSCHAIN_API_URL: undefined }).catch((e) => e);
    expect(err.message).toContain("CROSSCHAIN_API_URL");
    expect(err.message).toContain("EXPLORER_API_TOKEN");
    expect(err.message).toContain("NEXT_PUBLIC_STAGE=public");
    // Negative lookbehind, not a substring check: "CROSSCHAIN_API_URL" *contains*
    // "CHAIN_API_URL", so a plain not-toContain passes for the wrong reason.
    expect(err.message).not.toMatch(/(?<!CROSS)CHAIN_API_URL/);
  });

  it("builds when everything is configured", async () => {
    const mod = await loadDataModule(LIVE);
    expect(typeof mod.getDataSource().getCrossChainFlows).toBe("function");
  });

  it("leaves local and preview builds alone — fixtures are correct there", async () => {
    // The whole point of the fallback: the site runs with no server for local work.
    const mod = await loadDataModule({
      NEXT_PUBLIC_STAGE: undefined,
      CROSSCHAIN_API_URL: undefined,
      EXPLORER_API_TOKEN: undefined,
    });
    expect(typeof mod.getDataSource().getChainInfo).toBe("function");
  });
});

/**
 * Wherever the API is configured the miners overview comes from it; fixture miners are
 * reachable only with no API at all, so invented miners can never be published as the
 * chain's hashrate distribution.
 */
describe("the miners overview", () => {
  const usd = { closedUsd: 0, unpricedZat: 0, todayZat: 0 };
  const totals = { blocks: 9, addresses: 1, rewardZat: 9, feeZat: 0, usd };
  const overview = (window: string) => ({
    window,
    fromDay: "2026-10-08",
    toDay: "2026-11-06",
    fromHeight: 1,
    toHeight: 9,
    daysComputed: 30,
    daysExpected: 30,
    blocks: 9,
    unrecordedBlocks: 0,
    shieldedBlocks: 0,
    noAddressBlocks: 0,
    transparent: totals,
    unattributed: { ...totals, largest: [] },
    labelled: [],
    topBlocks: { top1: 9, top3: 9, top10: 9 },
    registry: [],
  });
  const stubFetch = (window: string) => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(String(url));
        return new Response(JSON.stringify(overview(window)), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    return urls;
  };
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is read from /chain/miners in a public build, never from fixtures", async () => {
    const urls = stubFetch("90d");
    const mod = await loadDataModule(LIVE);
    const got = await mod.getDataSource().getMinersOverview("90d");
    expect(got.blocks).toBe(9);
    expect(urls.some((u) => u.endsWith("/chain/miners?window=90d"))).toBe(true);
  });

  it("refuses an answer for a different window than the one asked for", async () => {
    // An API that ignored `?window=` answers the default month under a chip reading 90D.
    stubFetch("30d");
    const mod = await loadDataModule(LIVE);
    await expect(mod.getDataSource().getMinersOverview("90d")).rejects.toThrow(
      /unrecognised miners overview/,
    );
  });

  it("serves fixture miners only where no API is configured", async () => {
    const mod = await loadDataModule({
      NEXT_PUBLIC_STAGE: undefined,
      CROSSCHAIN_API_URL: undefined,
      EXPLORER_API_TOKEN: undefined,
    });
    const got = await mod.getDataSource().getMinersOverview("7d");
    expect(got.window).toBe("7d");
    expect(got.labelled.length).toBeGreaterThan(0);
  });
});
