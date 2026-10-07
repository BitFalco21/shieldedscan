import { afterEach, describe, expect, it, vi } from "vitest";
import { resetApiBreaker } from "../api-request";
import { createChainApiSource } from "../chain-api-source";

/**
 * The ZNS lookup adapter at its boundary. A name resolver's one unforgivable failure is sending a
 * reader to somebody else's address, so the echo check gets its own cases beside the shape ones.
 */

const config = { baseUrl: "https://api.example", token: "tkn" };
const ADDRESS = `u1${"q".repeat(100)}`;

const lookup = (query: string, extra: Record<string, unknown> = {}) => ({
  query,
  registrations: [
    {
      name: query,
      address: ADDRESS,
      txid: "a".repeat(64),
      height: 3_412_748,
      timestamp: 1_784_087_489,
      lastAction: "CLAIM",
      listingPriceZat: null,
    },
  ],
  history: [
    {
      action: "CLAIM",
      txid: "a".repeat(64),
      height: 3_412_748,
      timestamp: 1_784_087_489,
      address: ADDRESS,
      priceZat: null,
    },
  ],
  withheld: false,
  indexerHeight: 3_502_811,
  tipHeight: 3_502_812,
  asOf: 1_790_000_000,
  ...extra,
});

function stub(status: number, body: unknown) {
  return vi.fn().mockImplementation(() =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    } as unknown as Response),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetApiBreaker();
});

describe("getZnsName", () => {
  it("asks for the NORMALISED name, so `Zenith.zcash` and `zenith` share one cache entry", async () => {
    const fetchMock = stub(200, lookup("zenith"));
    vi.stubGlobal("fetch", fetchMock);
    const result = await createChainApiSource(config).getZnsName("Zenith.zcash");
    expect(String(fetchMock.mock.calls[0]![0])).toBe(`${config.baseUrl}/chain/zns/name/zenith`);
    expect(result!.registrations[0]!.address).toBe(ADDRESS);
  });

  it("refuses an answer about a different name", async () => {
    vi.stubGlobal("fetch", stub(200, lookup("grandma")));
    await expect(createChainApiSource(config).getZnsName("zenith")).rejects.toThrow(
      /answered a zns lookup for grandma/,
    );
  });

  it("resolves a 503 to null — no snapshot yet", async () => {
    vi.stubGlobal("fetch", stub(503, {}));
    expect(await createChainApiSource(config).getZnsName("zenith")).toBeNull();
  });

  it("rejects a registration whose address is not a unified one", async () => {
    const body = lookup("zenith");
    body.registrations[0]!.address = "t1abcdefghijklmnopqrstuvwxyz12345";
    vi.stubGlobal("fetch", stub(200, body));
    await expect(createChainApiSource(config).getZnsName("zenith")).rejects.toThrow(
      /unrecognised zns lookup shape/,
    );
  });

  it("rejects a body missing the withheld flag — an older shape must not read as current", async () => {
    const body: Record<string, unknown> = lookup("zenith");
    delete body.withheld;
    vi.stubGlobal("fetch", stub(200, body));
    await expect(createChainApiSource(config).getZnsName("zenith")).rejects.toThrow(
      /unrecognised zns lookup shape/,
    );
  });

  it("rejects a body without a history array — a shape from before the name page", async () => {
    const body: Record<string, unknown> = lookup("zenith");
    delete body.history;
    vi.stubGlobal("fetch", stub(200, body));
    await expect(createChainApiSource(config).getZnsName("zenith")).rejects.toThrow(
      /unrecognised zns lookup shape/,
    );
  });
});
