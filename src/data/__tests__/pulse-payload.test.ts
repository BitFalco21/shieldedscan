import { describe, expect, it } from "vitest";
import { parsePulseLive, parsePulseWindow } from "../pulse-payload";

/**
 * The wire guard for `/api/pulse/live` and `/api/pulse/window`.
 *
 * Beyond shape checks, these refuse an answer to a different question: the window route
 * echoes the hour it cut, and anything else is discarded rather than played. An hour of some
 * other time is a well-formed hour and would animate perfectly under the wrong label.
 */

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

const live = { kind: "pulse-live", frame, pending: { events: [], count: 0 } };

describe("parsePulseLive", () => {
  it("accepts a well-formed payload", () => {
    const parsed = parsePulseLive(live);
    expect(parsed?.frame.blocks).toHaveLength(1);
    expect(parsed?.pending?.count).toBe(0);
  });

  it("refuses a payload that does not echo its own kind", () => {
    // A shared cache key is infrastructure configuration and can regress silently; a missing
    // echo is a visible miss.
    expect(parsePulseLive({ ...live, kind: "pulse-window" })).toBeNull();
    expect(parsePulseLive({ ...live, kind: undefined })).toBeNull();
  });

  it("refuses a frame with no stocks, which is what the boxes read", () => {
    expect(parsePulseLive({ ...live, frame: { ...frame, stocks: undefined } })).toBeNull();
  });

  it("keeps `pending: null` distinct from a mempool that held nothing", () => {
    // Two opposite claims. `null` is "our node was not readable"; `{count: 0}` is a
    // measurement, and rendering one as the other would report an outage of ours as a fact
    // about the chain.
    expect(parsePulseLive({ ...live, pending: null })?.pending).toBeNull();
    expect(parsePulseLive(live)?.pending).toEqual({ events: [], count: 0 });
  });

  it("treats an unreadable pending block as unavailable rather than empty", () => {
    expect(parsePulseLive({ ...live, pending: { count: "many" } })?.pending).toBeNull();
  });

  it("drops a malformed BLOCK rather than failing the whole payload", () => {
    // Unlike the adapters' all-or-nothing rule: this is an enhancement layer over a page that
    // already rendered, so degrading to "no new blocks" keeps the reader with a good page.
    const parsed = parsePulseLive({
      ...live,
      frame: { ...frame, blocks: [block, { nonsense: true }] },
    });
    expect(parsed?.frame.blocks).toHaveLength(1);
  });

  it("drops a malformed swap without dropping the good ones", () => {
    const swap = { ...event, id: "swap:1", kind: "swap", height: null, blockHash: null };
    const parsed = parsePulseLive({
      ...live,
      frame: { ...frame, swaps: [swap, { id: "swap:2" }] },
    });
    expect(parsed?.frame.swaps.map((s) => s.id)).toEqual(["swap:1"]);
  });

  it("drops a ledger row with a NaN value rather than printing one", () => {
    const parsed = parsePulseLive({
      ...live,
      frame: {
        ...frame,
        ledger: [...frame.ledger, { ...frame.ledger[0], valueZat: Number.NaN }],
      },
    });
    expect(parsed?.frame.ledger).toHaveLength(1);
  });

  it("refuses anything that is not an object", () => {
    expect(parsePulseLive(null)).toBeNull();
    expect(parsePulseLive("frame")).toBeNull();
  });
});

const ledgerRow = {
  txid: "d".repeat(64),
  height: 100,
  blockHash: "b".repeat(64),
  address: "t1a",
  valueZat: 5,
};

const windowBody = {
  applied: { fromSeconds: 1_800_000_000, toSeconds: 1_800_003_600 },
  blocks: [block],
  swaps: [],
};

describe("parsePulseWindow", () => {
  it("accepts an hour that echoes the hour that was asked for", () => {
    const parsed = parsePulseWindow(windowBody, 1_800_000_000, 1_800_003_600);
    expect(parsed?.applied).toEqual(windowBody.applied);
    expect(parsed?.blocks).toHaveLength(1);
  });

  it("refuses an hour that is not the hour asked for", () => {
    // An API one deploy behind that ignored the parameters would answer a well-formed hour of
    // some other time, and the transport would play it under a label naming this one.
    expect(parsePulseWindow(windowBody, 1_800_003_600, 1_800_007_200)).toBeNull();
  });

  it("refuses a body with no echo at all, which is what an older API sends", () => {
    const { applied: _dropped, ...withoutEcho } = windowBody;
    expect(parsePulseWindow(withoutEcho, 1_800_000_000, 1_800_003_600)).toBeNull();
  });

  it("carries the truncation flag, which is how an hour says it is a slice", () => {
    expect(
      parsePulseWindow({ ...windowBody, truncated: true }, 1_800_000_000, 1_800_003_600)?.truncated,
    ).toBe(true);
    expect(parsePulseWindow(windowBody, 1_800_000_000, 1_800_003_600)?.truncated).toBeUndefined();
  });

  it("drops a malformed block rather than failing the hour", () => {
    const parsed = parsePulseWindow(
      { ...windowBody, blocks: [block, { nonsense: true }] },
      1_800_000_000,
      1_800_003_600,
    );
    expect(parsed?.blocks).toHaveLength(1);
  });

  it("carries the hour's own ledger rows", () => {
    const parsed = parsePulseWindow(
      { ...windowBody, ledger: [ledgerRow] },
      1_800_000_000,
      1_800_003_600,
    );
    expect(parsed?.ledger).toEqual([ledgerRow]);
  });

  it("leaves the rows ABSENT when the API sent none, never empty", () => {
    // The two are opposite claims. An API predating the field says nothing at all; `[]` would
    // state that no transparent value moved in the hour, and the page draws a different
    // sentence for each.
    expect(parsePulseWindow(windowBody, 1_800_000_000, 1_800_003_600)?.ledger).toBeUndefined();
  });

  it("keeps an EMPTY ledger empty, because that is a measurement", () => {
    expect(
      parsePulseWindow({ ...windowBody, ledger: [] }, 1_800_000_000, 1_800_003_600)?.ledger,
    ).toEqual([]);
  });

  it("drops a malformed row rather than failing the hour", () => {
    const parsed = parsePulseWindow(
      { ...windowBody, ledger: [ledgerRow, { txid: "x", valueZat: "lots" }] },
      1_800_000_000,
      1_800_003_600,
    );
    expect(parsed?.ledger).toEqual([ledgerRow]);
  });

  it("carries the ledger truncation flag, which is how an hour says its rows are a window", () => {
    expect(
      parsePulseWindow(
        { ...windowBody, ledger: [ledgerRow], ledgerTruncated: true },
        1_800_000_000,
        1_800_003_600,
      )?.ledgerTruncated,
    ).toBe(true);
    expect(
      parsePulseWindow(windowBody, 1_800_000_000, 1_800_003_600)?.ledgerTruncated,
    ).toBeUndefined();
  });
});
