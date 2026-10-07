import { describe, expect, it } from "vitest";
import { fixtureDataSource } from "../fixture-source";
import { isPulseBlock, isPulseBlockPools, isPulseEvent } from "../shape-guards";
import { hex64, TIP_HEIGHT } from "@/fixtures/ids";

/**
 * What the fixture chain must be able to express. Not a test of the numbers — they are
 * sample data — but of the shapes: each assertion names a state the page has to draw and the
 * fixture that is the only thing able to show it.
 */

const frame = await fixtureDataSource.getPulseFrame();
const events = frame.blocks.flatMap((b) => b.events);

describe("the fixture frame", () => {
  it("passes the guards the live payload is held to", () => {
    // The fixtures checked against the same shape guards the adapter uses: a field added to a
    // domain type tightens both.
    expect(isPulseBlockPools(frame.stocks)).toBe(true);
    expect(frame.blocks.every(isPulseBlock)).toBe(true);
    expect(frame.swaps.every(isPulseEvent)).toBe(true);
  });

  it("reads its boxes from the newest block's own row, never a tip from elsewhere", () => {
    // A balance and the height it was measured at come from one row. The node's tip may sit
    // above the newest indexed block, which is why they are separate.
    const newest = frame.blocks[frame.blocks.length - 1]!;
    expect(frame.stocks).toEqual(newest.pools);
    expect(frame.tip).toBeGreaterThanOrEqual(frame.stocks.height);
  });

  it("is ordered oldest first, so a replay plays the array forward", () => {
    const heights = frame.blocks.map((b) => b.pools.height);
    expect([...heights].sort((a, b) => a - b)).toEqual(heights);
  });

  it("draws a pool migration as a directed path", () => {
    const migration = events.find((e) => e.id === hex64("22d8e411"));
    expect(migration?.shape).toBe("path");
    expect(migration?.legs.map((l) => `${l.from}>${l.to}`)).toEqual(["orchard>ironwood"]);
  });

  it("draws a two-source migration with a leg per source", () => {
    const migration = events.find((e) => e.id === hex64("ea0a65f6"));
    expect(migration?.legs.map((l) => `${l.from}>${l.to}`).sort()).toEqual([
      "orchard>ironwood",
      "sapling>ironwood",
    ]);
  });

  it("draws a refused direction as a hub, with signed legs and no pairing", () => {
    // `c0ffee01…` moves its pools in opposite directions, so there is no direction to claim.
    // Every leg attaches to the hub and carries its own sign — never "from A + B into C".
    const hub = events.find((e) => e.id === hex64("c0ffee01"));
    expect(hub?.shape).toBe("hub");
    expect(hub?.legs.every((l) => l.from === "hub")).toBe(true);
    expect(hub?.legs.some((l) => (l.amountZat ?? 0) < 0)).toBe(true);
    expect(hub?.legs.some((l) => (l.amountZat ?? 0) > 0)).toBe(true);
  });

  it("draws a fully shielded transfer as the Veil and nothing else", () => {
    const veil = events.find((e) => e.id === hex64("a3f29c4e"));
    expect(veil?.shape).toBe("veil");
    expect(veil?.legs.every((l) => l.amountZat === null)).toBe(true);
  });

  it("draws a ZIP-213 coinbase as issuance into two places, with its subsidy", () => {
    const coinbase = events.find((e) => e.id === hex64(`cb${TIP_HEIGHT - 6}`));
    expect(coinbase?.kind).toBe("coinbase");
    expect(coinbase?.legs.map((l) => l.to).sort()).toEqual(["orchard", "transparent"]);
    // Sized on issuance rather than outputs: a coinbase collects the block's fees, so a subsidy
    // read off the outputs would overstate it.
    expect(coinbase?.subsidyZat).not.toBeNull();
  });

  it("folds a crossing into the transaction that carried it, so one movement is one mark", () => {
    const paired = events.find((e) => e.id === hex64("77d10b12"));
    expect(paired?.venue).toBe("maya");
    expect(paired?.legs.some((l) => l.from === "chain:BTC" || l.to === "chain:BTC")).toBe(true);
    // And it is not also a standalone swap — that would draw the same crossing twice.
    expect(frame.swaps.some((s) => s.zcashTxid === hex64("77d10b12"))).toBe(false);
  });

  it("carries an unpaired crossing that lands at the boundary, lighting no box", () => {
    // A `u1…` delivery ended on the shielded side, so it ends at the hub rather than the
    // transparent box; with no Zcash leg in the frame it has no height or hash, so it lights no
    // block.
    const unpaired = frame.swaps.find((s) => s.zcashTxid === hex64("aa04"));
    expect(unpaired).toBeDefined();
    expect(unpaired?.height).toBeNull();
    expect(unpaired?.blockHash).toBeNull();
    expect(unpaired?.legs.at(-1)?.to).toBe("hub");
  });

  it("carries a lockbox accrual, measured from two chained rows", () => {
    const lockbox = events.filter((e) => e.kind === "lockbox");
    expect(lockbox.length).toBeGreaterThan(0);
    expect(
      lockbox.every((e) => e.legs.every((l) => l.from === "mined" && l.to === "lockbox")),
    ).toBe(true);
    // Never zero: a block that deferred nothing produced no movement at all.
    expect(lockbox.every((e) => (e.legs[0]?.amountZat ?? 0) > 0)).toBe(true);
  });

  it("carries a heartbeat gap, a late-indexed block and an absent pool close", () => {
    // Three states with no other way onto the screen, each a null the page must draw as an
    // absence rather than a measurement.
    expect(frame.blocks.some((b) => b.pools.receivedAt === null)).toBe(true);
    expect(frame.blocks.some((b) => b.intervalSeconds === null)).toBe(true);
    expect(frame.blocks.some((b) => b.indexedLate === true)).toBe(true);
    expect(frame.blocks.some((b) => Object.values(b.pools.pools).includes(null))).toBe(true);
  });

  it("carries a truncated block, whose count exceeds what it drew", () => {
    const truncated = frame.blocks.find((b) => b.truncated);
    expect(truncated).toBeDefined();
    expect(truncated!.eventCount).toBeGreaterThan(truncated!.events.length);
  });

  it("carries no truncated flag on a complete block", () => {
    const complete = frame.blocks.filter((b) => !b.truncated);
    expect(complete.every((b) => b.eventCount === b.events.length)).toBe(true);
  });

  it("lists real transparent outputs, never a mempool one and never a coinbase pairing", () => {
    expect(frame.ledger.length).toBeGreaterThan(0);
    expect(frame.ledger.every((r) => r.address !== "" && r.valueZat > 0)).toBe(true);
    expect(frame.ledger.every((r) => Number.isInteger(r.height))).toBe(true);
  });
});

describe("the fixture mempool", () => {
  it("marks every pending movement as pending, with no height to light a block", async () => {
    const pending = await fixtureDataSource.getPulsePending();
    expect(pending!.count).toBe(pending!.events.length);
    expect(pending!.events.every((e) => e.pending === true)).toBe(true);
    expect(pending!.events.every((e) => e.height === null && e.blockHash === null)).toBe(true);
  });
});

describe("the fixture ribbons", () => {
  it("offers three windows that are not the same window", async () => {
    // A range control whose options all draw the same thing is a dead control.
    const ribbons = (await fixtureDataSource.getPulseRibbons())!;
    const total = (name: "all" | "1y" | "30d") =>
      ribbons.windows[name].edges.reduce((sum, e) => sum + e.totalZat, 0);
    expect(total("all")).toBeGreaterThan(total("1y"));
    expect(total("1y")).toBeGreaterThan(total("30d"));
  });

  it("marks a venue edge as a floor and a Sprout edge as vpub-derived", async () => {
    const ribbons = (await fixtureDataSource.getPulseRibbons())!;
    const edges = ribbons.windows.all.edges;
    expect(edges.some((e) => e.floor === true)).toBe(true);
    expect(edges.some((e) => e.vpubDerived === true)).toBe(true);
  });

  it("reports the hub totals no ribbon can state", async () => {
    const ribbons = (await fixtureDataSource.getPulseRibbons())!;
    expect(ribbons.windows.all.unpaired.hubTxs).toBeGreaterThan(0);
  });

  it("reports a multi-source migration as unpaired rather than as one ribbon per source", async () => {
    // `ea0a65f6…` drains Sapling and Orchard into Ironwood, which publishes one figure both
    // sources share. A ribbon per source would apportion it, which `poolMigration` refuses; the
    // matview files it under `'multi'` and the ribbons exclude it, and the fixture must agree.
    const ribbons = (await fixtureDataSource.getPulseRibbons())!;
    const { unpaired, edges } = ribbons.windows.all;
    expect(unpaired.multiMigrationTxs).toBeGreaterThan(0);
    // The destination's own published figure, never the sum of the source legs (which
    // includes the fee).
    expect(unpaired.multiMigrationZat).toBe(209_951_599_526);
    expect(edges.some((e) => e.from === "sapling" && e.to === "ironwood")).toBe(false);
    // The single-source migration in the same frame has a settled direction and is a ribbon.
    expect(edges.some((e) => e.from === "orchard" && e.to === "ironwood")).toBe(true);
  });
});
