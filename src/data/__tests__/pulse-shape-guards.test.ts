import { describe, expect, it } from "vitest";
import { isPulseBlock, isPulseEvent } from "../shape-guards";
import { PULSE_EVENT_KINDS, PULSE_SHAPES } from "@/domain";

/**
 * The `/pulse` version-skew tripwires. Shallow by design — the API is ours — but on this page
 * a silent `undefined` is worse than a blank cell: an amount that is not a number is drawn as
 * a mark, asserting a movement of some size with nothing to say the figure is missing.
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
  transparent: 1_000,
  sprout: null,
  sapling: 2_000,
  orchard: 3_000,
  ironwood: 4_000,
  lockbox: 5_000,
};

const block = {
  pools: {
    height: 100,
    hash: "b".repeat(64),
    prevHash: "c".repeat(64),
    timestamp: 1_800_000_000,
    receivedAt: 1_800_000_003,
    pools,
  },
  events: [event],
  eventCount: 1,
  intervalSeconds: 75,
};

describe("isPulseEvent", () => {
  it("accepts a complete event", () => {
    expect(isPulseEvent(event)).toBe(true);
  });

  it("accepts an event with no fee key at all", () => {
    // `feeZat` is optional on the domain type — a swap has no fee to state — so requiring it
    // would make the guard stricter than the shape it guards.
    const { feeZat: _dropped, ...withoutFee } = event;
    expect(isPulseEvent(withoutFee)).toBe(true);
  });

  it("rejects an event with no subsidy key", () => {
    // `subsidyZat` is required and nullable: an absent key is an API that predates it, and
    // reading it as "no subsidy" would state a coinbase issued nothing.
    const { subsidyZat: _dropped, ...withoutSubsidy } = event;
    expect(isPulseEvent(withoutSubsidy)).toBe(false);
  });

  it("rejects a NaN leg amount rather than drawing a mark of some size", () => {
    expect(isPulseEvent({ ...event, legs: [{ ...leg, amountZat: Number.NaN }] })).toBe(false);
  });

  it("accepts a null leg amount, which is the Veil and the Sprout gap", () => {
    expect(isPulseEvent({ ...event, legs: [{ ...leg, amountZat: null }] })).toBe(true);
  });

  it.each(PULSE_EVENT_KINDS)("accepts every kind the domain declares — %s", (kind) => {
    // Derived from the domain's own list: a kind present in the type and missing from the guard
    // would be silently dropped by the client parser's `.filter(isPulseEvent)`.
    expect(isPulseEvent({ ...event, kind })).toBe(true);
  });

  it.each(PULSE_SHAPES)("accepts every shape the domain declares — %s", (shape) => {
    expect(isPulseEvent({ ...event, shape })).toBe(true);
  });

  it("rejects an unknown kind or shape, which nothing downstream can draw", () => {
    expect(isPulseEvent({ ...event, kind: "teleport" })).toBe(false);
    expect(isPulseEvent({ ...event, shape: "spiral" })).toBe(false);
  });

  it("rejects a non-finite time, which would place the mark nowhere", () => {
    expect(isPulseEvent({ ...event, at: Number.NaN })).toBe(false);
  });

  it("rejects a height that is neither a number nor null", () => {
    expect(isPulseEvent({ ...event, height: "100" })).toBe(false);
  });

  it("rejects a non-object", () => {
    expect(isPulseEvent(null)).toBe(false);
    expect(isPulseEvent("event")).toBe(false);
  });
});

describe("isPulseBlock", () => {
  it("accepts a complete block", () => {
    expect(isPulseBlock(block)).toBe(true);
  });

  it("accepts a null pool balance, which the page draws as unavailable", () => {
    expect(isPulseBlock(block)).toBe(true);
  });

  it("rejects a block missing a value pool entirely", () => {
    // A missing pool is an API that does not know about one; an absent key would draw five
    // pools as though they were six. A null is a measurement gap and is fine.
    const { ironwood: _dropped, ...fivePools } = pools;
    expect(isPulseBlock({ ...block, pools: { ...block.pools, pools: fivePools } })).toBe(false);
  });

  it("rejects a NaN pool balance", () => {
    expect(
      isPulseBlock({
        ...block,
        pools: { ...block.pools, pools: { ...pools, sapling: Number.NaN } },
      }),
    ).toBe(false);
  });

  it("rejects a block whose events do not check out", () => {
    expect(isPulseBlock({ ...block, events: [{ nonsense: true }] })).toBe(false);
  });

  it("rejects a block with no event count, which is what makes a cap honest", () => {
    const { eventCount: _dropped, ...withoutCount } = block;
    expect(isPulseBlock(withoutCount)).toBe(false);
  });

  it("accepts a null interval, which the heartbeat draws as a gap", () => {
    expect(isPulseBlock({ ...block, intervalSeconds: null })).toBe(true);
  });

  it("rejects a missing interval key, which is not the same as a recorded gap", () => {
    const { intervalSeconds: _dropped, ...withoutInterval } = block;
    expect(isPulseBlock(withoutInterval)).toBe(false);
  });
});
