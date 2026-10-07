import { describe, expect, it } from "vitest";
import type { PulseEvent, PulseLeg } from "@/domain";
import {
  collapsedHubTitle,
  collapsedTitle,
  collapsedVeilTitle,
  coverageNote,
  eventTitle,
  isCrossing,
  pulseLogLine,
} from "../pulse-text";

/** Every sentence the page is allowed to say. */

const ZEC = 100_000_000;

const base = (over: Partial<PulseEvent> = {}): PulseEvent => ({
  id: "tx-1",
  kind: "tx",
  shape: "path",
  at: 1_000,
  height: 10,
  blockHash: "h".repeat(64),
  legs: [],
  subsidyZat: null,
  ...over,
});

const leg = (from: PulseLeg["from"], to: PulseLeg["to"], amountZat: number | null): PulseLeg => ({
  from,
  to,
  amountZat,
});

describe("isCrossing — a PAIRED crossing keeps its transaction's kind", () => {
  it("recognises a crossing folded into the transaction that carried its Zcash leg", () => {
    // `pairSwapsWithTxs` merges the venue's leg into the transaction, so the merged event is a
    // `tx`. A predicate keyed on `kind === "swap"` would miss exactly the crossings the chain
    // did record.
    const paired = base({ kind: "tx", counterpartChain: "BTC", venue: "maya" });
    expect(paired.kind).not.toBe("swap");
    expect(isCrossing(paired)).toBe(true);
  });

  it("recognises an unpaired one, and refuses an ordinary transaction", () => {
    expect(isCrossing(base({ kind: "swap", counterpartChain: "ETH" }))).toBe(true);
    expect(isCrossing(base())).toBe(false);
  });
});

describe("incl. fee names an UNSHIELDING leg and nothing else", () => {
  it("says it for value leaving a shielded pool", () => {
    const l = leg("orchard", "transparent", 5 * ZEC);
    expect(eventTitle(base({ legs: [l] }), l)).toContain("incl. fee");
  });

  it("does NOT say it for a crossing arriving on the transparent ledger", () => {
    // The Zcash leg of an inbound crossing pays no Zcash fee, so it must not say `incl. fee`.
    const l = leg("chain:BTC", "transparent", 12 * ZEC);
    const event = base({ kind: "swap", counterpartChain: "BTC", legs: [l] });
    expect(eventTitle(event, l)).not.toContain("incl. fee");
    expect(pulseLogLine(event).kind).not.toContain("incl. fee");
  });

  it("does NOT say it for issuance", () => {
    const l = leg("mined", "transparent", 3 * ZEC);
    expect(eventTitle(base({ kind: "coinbase", legs: [l] }), l)).not.toContain("incl. fee");
  });
});

describe("a crossing's caveats survive the fold", () => {
  it("names the venue, the floor and the counterpart on a PAIRED crossing", () => {
    const l = leg("chain:ETH", "transparent", ZEC);
    const event = base({
      kind: "tx",
      venue: "near-intents",
      counterpartChain: "ETH",
      counterpartAsset: "USDC",
      legs: [l],
    });
    const title = eventTitle(event, l);
    expect(title).toContain("USDC on ETH");
    expect(title).toContain("public venues only");
    expect(title).toContain("near-intents");
    // The log row names the venue and the counterpart; the floor caveat lives on the titles.
    expect(pulseLogLine(event).kind).toContain("near-intents");
    expect(pulseLogLine(event).kind).not.toContain("public venues only");
  });

  it("labels a wrapped counterpart, and a ticker the venue never published", () => {
    const l = leg("chain:MAYA", "transparent", ZEC);
    expect(
      eventTitle(base({ counterpartChain: "MAYA", counterpartIsSynthetic: true, legs: [l] }), l),
    ).toContain("wrapped ZEC (synthetic)");
    expect(
      eventTitle(base({ counterpartChain: "SOL", counterpartAsset: "SOL asset", legs: [l] }), l),
    ).toContain("ticker unknown");
  });

  it("names a chain's own coin once", () => {
    const l = leg("chain:BTC", "transparent", ZEC);
    const title = eventTitle(
      base({ counterpartChain: "BTC", counterpartAsset: "BTC", legs: [l] }),
      l,
    );
    // "BTC on BTC" is true and reads as a mistake.
    expect(title).not.toContain("BTC on BTC");
    expect(title).toContain("BTC");
  });

  it("says a crossing landed at a shielded address when its leg ends at the boundary", () => {
    const l = leg("chain:BTC", "hub", ZEC);
    expect(eventTitle(base({ counterpartChain: "BTC", legs: [l] }), l)).toContain(
      "lands at a shielded address",
    );
  });

  it("says an unpaired crossing has no block behind it", () => {
    const l = leg("chain:BTC", "transparent", ZEC);
    const event = base({ kind: "swap", height: null, counterpartChain: "BTC", legs: [l] });
    expect(eventTitle(event, l)).toContain("placed at venue time · no block has recorded it");
    expect(pulseLogLine(event).kind).toContain("no block has recorded it");
  });
});

describe("coverage — a capped block never presents its slice as its total", () => {
  it("says how many of how many were drawn", () => {
    expect(coverageNote({ drawn: 300, total: 2_450 })).toBe("300 of 2,450 drawn");
  });

  it("says nothing when the block is whole", () => {
    // A note on a complete block would read as a cap that is not there.
    expect(coverageNote({ drawn: 12, total: 12 })).toBeNull();
    expect(coverageNote(undefined)).toBeNull();
  });

  it("rides on a mark's own title and on a collapsed edge's", () => {
    const l = leg("transparent", "orchard", ZEC);
    expect(eventTitle(base({ legs: [l] }), l, { drawn: 300, total: 2_450 })).toContain(
      "300 of 2,450 drawn",
    );
    expect(
      collapsedTitle(4, ZEC, 10, "transparent", "orchard", { drawn: 300, total: 2_450 }),
    ).toContain("300 of 2,450 drawn");
  });
});

describe("what a collapsed block says about movements it cannot sum", () => {
  it("counts the shielded ones at their pool, with no amount", () => {
    const title = collapsedVeilTitle(7, "orchard", 3_428_150);
    expect(title).toBe("7 inside orchard · amounts private by design · block 3,428,150");
    expect(title).not.toMatch(/ZEC/);
  });

  it("counts the unsettled ones without naming a direction", () => {
    expect(collapsedHubTitle(3, 3_428_150)).toBe(
      "3 unsettled · direction not settled by the chain · block 3,428,150",
    );
  });
});

describe("a hub states its signed legs and stops", () => {
  it("never pairs a source to a destination", () => {
    const event = base({
      shape: "hub",
      feeZat: 10_000,
      legs: [
        leg("transparent", "hub", 5 * ZEC),
        leg("sapling", "hub", 2 * ZEC),
        leg("hub", "orchard", 7 * ZEC),
      ],
    });
    const title = eventTitle(event);
    expect(title).toContain("direction not settled by the chain");
    expect(title).not.toMatch(/→/);
    expect(pulseLogLine(event).text).not.toMatch(/→/);
  });
});
