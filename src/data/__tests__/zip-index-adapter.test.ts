import { afterEach, describe, expect, it, vi } from "vitest";
import { createChainApiSource } from "../chain-api-source";

/**
 * The ZIP index adapter's contract, tested against a stubbed `fetch` — same standard as
 * `chain-api-source.test.ts`: what matters is how this file behaves at the boundary, not
 * what the node returns.
 */

const config = { baseUrl: "https://api.example", token: "tkn" };

const validBody = {
  asOf: 1_753_390_000,
  source: "github.com/zcash/zips",
  skippedFiles: 0,
  zips: [
    {
      zip: 213,
      title: "Shielded Coinbase",
      status: "Final",
      statusKind: "final",
      category: "Consensus",
      created: "2019-03-30",
    },
  ],
};

function stub(status: number, body: unknown) {
  return vi.fn().mockImplementation(() =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    } as unknown as Response),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("getZipIndex", () => {
  it("fetches /chain/zips with the bearer token", async () => {
    const fetchMock = stub(200, validBody);
    vi.stubGlobal("fetch", fetchMock);
    await createChainApiSource(config).getZipIndex();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(`${config.baseUrl}/chain/zips`);
    expect((init as { headers: Record<string, string> }).headers.authorization).toBe(
      `Bearer ${config.token}`,
    );
  });

  it("resolves a 200 with a valid body to the ZipIndex verbatim", async () => {
    vi.stubGlobal("fetch", stub(200, validBody));
    const result = await createChainApiSource(config).getZipIndex();
    expect(result).toEqual(validBody);
  });

  it("resolves a 503 to null, the page's unavailable state", async () => {
    vi.stubGlobal("fetch", stub(503, {}));
    const result = await createChainApiSource(config).getZipIndex();
    expect(result).toBeNull();
  });

  it("rejects a malformed body — zips not an array", async () => {
    vi.stubGlobal("fetch", stub(200, { ...validBody, zips: "nope" }));
    await expect(createChainApiSource(config).getZipIndex()).rejects.toThrow(
      /unrecognised zip index shape/,
    );
  });

  it("rejects a malformed body — a row missing a numeric zip", async () => {
    vi.stubGlobal(
      "fetch",
      stub(200, { ...validBody, zips: [{ ...validBody.zips[0], zip: "213" }] }),
    );
    await expect(createChainApiSource(config).getZipIndex()).rejects.toThrow(
      /unrecognised zip index shape/,
    );
  });

  it("rejects a malformed body — a row missing a string title", async () => {
    vi.stubGlobal(
      "fetch",
      stub(200, { ...validBody, zips: [{ ...validBody.zips[0], title: null }] }),
    );
    await expect(createChainApiSource(config).getZipIndex()).rejects.toThrow(
      /unrecognised zip index shape/,
    );
  });

  it("rejects a malformed body — a row missing a string status", async () => {
    vi.stubGlobal(
      "fetch",
      stub(200, { ...validBody, zips: [{ ...validBody.zips[0], status: 42 }] }),
    );
    await expect(createChainApiSource(config).getZipIndex()).rejects.toThrow(
      /unrecognised zip index shape/,
    );
  });

  it("rejects a malformed body — zero rows is a failure, never an empty index", async () => {
    vi.stubGlobal("fetch", stub(200, { ...validBody, zips: [] }));
    await expect(createChainApiSource(config).getZipIndex()).rejects.toThrow(
      /unrecognised zip index shape/,
    );
  });

  it("rejects on 404 — a missing deploy stays loud", async () => {
    vi.stubGlobal("fetch", stub(404, { error: "not found" }));
    await expect(createChainApiSource(config).getZipIndex()).rejects.toThrow(/404/);
  });
});
