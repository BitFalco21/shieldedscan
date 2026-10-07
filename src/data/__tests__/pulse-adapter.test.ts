import { afterEach, describe, expect, it, vi } from "vitest";
import { createChainApiSource } from "../chain-api-source";

/**
 * The four `/pulse` reads at the adapter boundary: which statuses mean "not yet", which
 * reject, and whether a payload that cannot be drawn fails loudly rather than reaching the
 * page as a mark of some size.
 *
 * The window read carries the one check no shape can make: the API must echo the hour it
 * cut, because an hour of some other time is a well-formed hour.
 */

const config = { baseUrl: "https://api.example", token: "tkn" };

const leg = { from: "transparent", to: "orchard", amountZat: 1_000 };
const event = {
  id: "a".repeat(64),
  kind: "tx",
  shape: "path",
  at: 1_800_000_000,
  height: 100,
  blockHash: "b".repeat(64),
  legs: [leg],
  subsidyZat: null,
  feeZat: 10_000,
};
const pools = {
  height: 100,
  hash: "b".repeat(64),
  prevHash: "c".repeat(64),
  timestamp: 1_800_000_000,
  receivedAt: 1_800_000_003,
  pools: { transparent: 1, sprout: null, sapling: 2, orchard: 3, ironwood: 4, lockbox: 5 },
};
const block = { pools, events: [event], eventCount: 1, intervalSeconds: 75 };

const frame = {
  window: { fromSeconds: 1_799_999_000, toSeconds: 1_800_000_001 },
  tip: 101,
  stocks: pools,
  blocks: [block],
  swaps: [],
  ledger: [
    { txid: "d".repeat(64), height: 100, blockHash: "b".repeat(64), address: "t1a", valueZat: 5 },
  ],
};

const ribbonWindow = {
  window: { fromSeconds: 0, toSeconds: 1_800_000_000 },
  edges: [{ from: "transparent", to: "orchard", totalZat: 10, events: 2 }],
  unpaired: { hubZat: 0, hubTxs: 0, multiMigrationZat: 0, multiMigrationTxs: 0 },
};
const ribbons = {
  asOf: 1_800_000_000,
  height: 100,
  windows: { all: ribbonWindow, "1y": ribbonWindow, "30d": ribbonWindow },
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

describe("getPulseFrame", () => {
  it("fetches /chain/pulse/frame with the bearer token and a short cache window", async () => {
    const fetchMock = stub(200, frame);
    vi.stubGlobal("fetch", fetchMock);
    await createChainApiSource(config).getPulseFrame();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(`${config.baseUrl}/chain/pulse/frame`);
    expect((init as { headers: Record<string, string> }).headers.authorization).toBe(
      `Bearer ${config.token}`,
    );
    // The source's tip window (15 s by default). The polling route forces it to zero with
    // `force-no-store`; the prerendered page uses a 60-second source
    // (`getPrerenderedDataSource`).
    expect((init as { next?: { revalidate?: number } }).next?.revalidate).toBe(15);
  });

  it("resolves a valid frame verbatim", async () => {
    vi.stubGlobal("fetch", stub(200, frame));
    expect(await createChainApiSource(config).getPulseFrame()).toEqual(frame);
  });

  it("rejects a frame with a NaN pool balance rather than sizing a box on it", async () => {
    const broken = { ...frame, stocks: { ...pools, pools: { ...pools.pools, orchard: "3" } } };
    vi.stubGlobal("fetch", stub(200, broken));
    await expect(createChainApiSource(config).getPulseFrame()).rejects.toThrow(/unrecognised/);
  });

  it("rejects a ledger row with no address behind the elision", async () => {
    // The row shows an elided address and keeps the full string in `title` and on the copy
    // control, so a missing one copies nothing and shows an elision of it.
    vi.stubGlobal(
      "fetch",
      stub(200, { ...frame, ledger: [{ ...frame.ledger[0], address: null }] }),
    );
    await expect(createChainApiSource(config).getPulseFrame()).rejects.toThrow(/unrecognised/);
  });

  it("rejects a NaN tip or window bound rather than placing the frame nowhere", async () => {
    // Every amount is checked finite, the frame's scalars included: a NaN tip misdates the
    // header and a NaN window boundary misplaces every mark on the transport.
    for (const broken of [
      { ...frame, tip: Number.NaN },
      { ...frame, window: { fromSeconds: Number.NaN, toSeconds: 1 } },
    ]) {
      vi.stubGlobal("fetch", stub(200, broken));
      await expect(createChainApiSource(config).getPulseFrame()).rejects.toThrow(/unrecognised/);
    }
  });

  it("rejects a frame whose blocks do not check out", async () => {
    vi.stubGlobal("fetch", stub(200, { ...frame, blocks: [{ nonsense: true }] }));
    await expect(createChainApiSource(config).getPulseFrame()).rejects.toThrow(/unrecognised/);
  });

  it("rejects rather than resolving when the index holds no blocks", async () => {
    // The API answers 503 there. Unlike the ribbons this is not a "not yet": an empty frame
    // would state that every pool holds nothing.
    vi.stubGlobal("fetch", stub(503, { error: "the chain index holds no blocks yet" }));
    await expect(createChainApiSource(config).getPulseFrame()).rejects.toThrow(/503/);
  });
});

describe("getPulsePending", () => {
  it("resolves a 503 to null — a cold mempool is not an empty one", async () => {
    vi.stubGlobal("fetch", stub(503, { error: "the mempool has not been read yet" }));
    expect(await createChainApiSource(config).getPulsePending()).toBeNull();
  });

  it("resolves a snapshot with its read time", async () => {
    vi.stubGlobal("fetch", stub(200, { asOf: 1_800_000_000, count: 2, events: [event] }));
    const pending = await createChainApiSource(config).getPulsePending();
    expect(pending).toEqual({ asOf: 1_800_000_000, count: 2, events: [event] });
  });

  it("rejects a snapshot with no count, which is what makes a cap honest", async () => {
    vi.stubGlobal("fetch", stub(200, { asOf: 1, events: [] }));
    await expect(createChainApiSource(config).getPulsePending()).rejects.toThrow(/unrecognised/);
  });

  it("drops nothing silently: a malformed event fails the snapshot", async () => {
    vi.stubGlobal("fetch", stub(200, { asOf: 1, count: 1, events: [{ id: "x" }] }));
    await expect(createChainApiSource(config).getPulsePending()).rejects.toThrow(/unrecognised/);
  });
});

describe("getPulseWindow", () => {
  const from = 1_800_000_000;
  const to = 1_800_003_600;
  const hour = { applied: { fromSeconds: from, toSeconds: to }, blocks: [block], swaps: [] };

  it("asks for the hour and resolves the hour it was given", async () => {
    const fetchMock = stub(200, hour);
    vi.stubGlobal("fetch", fetchMock);
    const result = await createChainApiSource(config).getPulseWindow(from, to);
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      `${config.baseUrl}/chain/pulse/window?from=${from}&to=${to}`,
    );
    expect(result).toEqual(hour);
  });

  it("refuses a body whose applied window is a different hour", async () => {
    // An API that ignored the parameters answers a well-formed hour of some other time; the
    // echo is the only mechanical check.
    vi.stubGlobal("fetch", stub(200, hour));
    await expect(
      createChainApiSource(config).getPulseWindow(from + 3_600, to + 3_600),
    ).rejects.toThrow(/applied/);
  });

  it("refuses a body with no echo at all, which is what an older API sends", async () => {
    vi.stubGlobal("fetch", stub(200, { blocks: [], swaps: [] }));
    await expect(createChainApiSource(config).getPulseWindow(from, to)).rejects.toThrow(/applied/);
  });

  it("carries the truncation flag rather than dropping it", async () => {
    vi.stubGlobal("fetch", stub(200, { ...hour, truncated: true }));
    expect((await createChainApiSource(config).getPulseWindow(from, to)).truncated).toBe(true);
  });

  it("carries the hour's own ledger rows and the flag saying they are a window", async () => {
    vi.stubGlobal("fetch", stub(200, { ...hour, ledger: frame.ledger, ledgerTruncated: true }));
    const result = await createChainApiSource(config).getPulseWindow(from, to);
    expect(result.ledger).toEqual(frame.ledger);
    expect(result.ledgerTruncated).toBe(true);
  });

  it("leaves the rows ABSENT for an API that does not send them, never empty", async () => {
    // Absent is "not carried"; `[]` would be "this hour moved no transparent value". The page
    // says a different sentence for each.
    vi.stubGlobal("fetch", stub(200, hour));
    const result = await createChainApiSource(config).getPulseWindow(from, to);
    expect(result.ledger).toBeUndefined();
    expect(result.ledgerTruncated).toBeUndefined();
  });

  it("rejects a malformed row rather than dropping it silently", async () => {
    // The version-skew tripwire: silently shortening our own API's answer is the degradation
    // it exists to make loud.
    vi.stubGlobal("fetch", stub(200, { ...hour, ledger: [{ txid: "x", valueZat: "lots" }] }));
    await expect(createChainApiSource(config).getPulseWindow(from, to)).rejects.toThrow(
      /unrecognised pulse window ledger/,
    );
  });
});

describe("getPulseRibbons", () => {
  it("resolves a 503 to null — the day views have not been filled yet", async () => {
    vi.stubGlobal("fetch", stub(503, { error: "the pool day views have not been populated yet" }));
    expect(await createChainApiSource(config).getPulseRibbons()).toBeNull();
  });

  it("rejects a 404, which means the endpoint is not deployed", async () => {
    // A 404 must stay loud: resolving it to null would render the unavailable state over a
    // missing deploy.
    vi.stubGlobal("fetch", stub(404, { error: "not found" }));
    await expect(createChainApiSource(config).getPulseRibbons()).rejects.toThrow(/404/);
  });

  it("resolves all three windows verbatim", async () => {
    vi.stubGlobal("fetch", stub(200, ribbons));
    expect(await createChainApiSource(config).getPulseRibbons()).toEqual(ribbons);
  });

  it("rejects a payload missing a window, rather than drawing two of three", async () => {
    const { "30d": _dropped, ...twoWindows } = ribbons.windows;
    vi.stubGlobal("fetch", stub(200, { ...ribbons, windows: twoWindows }));
    await expect(createChainApiSource(config).getPulseRibbons()).rejects.toThrow(/unrecognised/);
  });

  it("rejects a NaN in the unpaired remainder, which is what the ribbons left out", async () => {
    const broken = {
      ...ribbons,
      windows: {
        ...ribbons.windows,
        all: { ...ribbonWindow, unpaired: { ...ribbonWindow.unpaired, hubZat: Number.NaN } },
      },
    };
    vi.stubGlobal("fetch", stub(200, broken));
    await expect(createChainApiSource(config).getPulseRibbons()).rejects.toThrow(/unrecognised/);
  });

  it("rejects an edge with a NaN total rather than drawing a ribbon of some width", async () => {
    const broken = {
      ...ribbons,
      windows: {
        ...ribbons.windows,
        all: { ...ribbonWindow, edges: [{ from: "a", to: "b", totalZat: Number.NaN, events: 1 }] },
      },
    };
    vi.stubGlobal("fetch", stub(200, broken));
    await expect(createChainApiSource(config).getPulseRibbons()).rejects.toThrow(/unrecognised/);
  });
});
