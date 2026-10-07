import { describe, expect, it } from "vitest";
import { blockSummaryOf } from "@/domain";
import { blocks } from "@/fixtures/blocks";
import { transactions } from "@/fixtures/transactions";
import { crossChainTransfers } from "@/fixtures/crosschain";
import { parseLivePayload } from "../live-payload";

/**
 * The wire guard for `/api/live`.
 *
 * It is a shallow shape tripwire for version skew, like `chain-api-source.ts`'s validators,
 * and it refuses an answer to a different question: the route echoes the `kind` and
 * `direction` it applied, and a mismatch means a cache or proxy answered something we did not
 * ask. A CDN entry keyed without the query parameter is a configuration mistake that reading
 * the code cannot reveal; the echo turns it into a visible miss instead of a confident wrong
 * row, such as a transparent transaction in a list chipped SHIELDED.
 */

const payload = (over: Record<string, unknown> = {}) => ({
  kind: "all",
  direction: "all",
  tip: { height: 3450293, hash: "0000abc", lastBlockTimestamp: 1786916930 },
  // List rows, as the route sends them.
  blocks: [blockSummaryOf(blocks[0]!)],
  transactions: [transactions[0]],
  transfers: [crossChainTransfers[0]],
  ...over,
});

describe("parseLivePayload", () => {
  it("accepts a well-formed payload answering the question we asked", () => {
    const parsed = parseLivePayload(payload(), "all", "all");

    expect(parsed?.blocks).toHaveLength(1);
    expect(parsed?.transactions).toHaveLength(1);
    expect(parsed?.transfers).toHaveLength(1);
    expect(parsed?.tip.height).toBe(3450293);
  });

  it("refuses a payload answering a DIFFERENT kind", () => {
    // The failure this prevents: a shared cache entry for ?kind=all served to a reader on
    // ?kind=shielded, whose list would then show transparent rows under a SHIELDED chip.
    expect(parseLivePayload(payload({ kind: "all" }), "shielded", "all")).toBeNull();
  });

  it("refuses a payload with the echo MISSING", () => {
    // Strict on purpose. An absent echo is what an API predating the field sends, and being
    // lenient would keep accepting exactly the responses this guard exists to catch.
    const { kind: _dropped, ...withoutEcho } = payload();
    expect(parseLivePayload(withoutEcho, "all", "all")).toBeNull();
  });

  it("refuses a payload with no tip", () => {
    // The tip is what every relative age on the page is measured against, and what makes a
    // reorg detectable. A payload without one is not a degraded answer, it is a broken one.
    expect(parseLivePayload(payload({ tip: null }), "all", "all")).toBeNull();
  });

  it("drops a malformed block rather than rendering undefined into a row", () => {
    const parsed = parseLivePayload(
      payload({ blocks: [blockSummaryOf(blocks[0]!), { height: 1 }] }),
      "all",
      "all",
    );

    expect(parsed?.blocks).toHaveLength(1);
  });

  it("reads a FULL block row as the same list row, for a route one deploy behind", () => {
    // An older route sent whole blocks. A tab open across a deploy, or an older CDN entry,
    // must still read them, and read them identically.
    const full = parseLivePayload(payload({ blocks: [blocks[0]] }), "all", "all");
    const summary = parseLivePayload(payload(), "all", "all");

    expect(full?.blocks).toEqual(summary?.blocks);
    expect(full?.blocks[0]?.txCount).toBe(blocks[0]!.txids.length);
  });

  it("drops a malformed transaction rather than rendering undefined into a row", () => {
    const parsed = parseLivePayload(payload({ transactions: [{ txid: "abc" }] }), "all", "all");

    expect(parsed?.transactions).toEqual([]);
  });

  it("treats absent transfers as an empty list, because testnet omits them", () => {
    // Testnet serves no cross-chain data at all, so the key is legitimately absent there.
    // That must not fail the whole payload and take blocks and transactions down with it.
    const { transfers: _absent, ...withoutTransfers } = payload();
    const parsed = parseLivePayload(withoutTransfers, "all", "all");

    expect(parsed?.transfers).toEqual([]);
    expect(parsed?.blocks).toHaveLength(1);
  });

  it("refuses a non-object", () => {
    expect(parseLivePayload("nope", "all", "all")).toBeNull();
    expect(parseLivePayload(null, "all", "all")).toBeNull();
  });

  it("refuses a payload answering a different DIRECTION", () => {
    // Direction is a cheap server-side cache key (three values) and gets the same guarantee:
    // an API that ignored `?direction=in` would answer with outbound transfers under an
    // INBOUND chip, and an unfiltered list is a well-formed list.
    expect(parseLivePayload(payload({ direction: "all" }), "all", "in")).toBeNull();
  });

  it("refuses a payload with the direction echo MISSING", () => {
    const { direction: _dropped, ...withoutEcho } = payload();
    expect(parseLivePayload(withoutEcho, "all", "all")).toBeNull();
  });
});
