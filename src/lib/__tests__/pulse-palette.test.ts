import { describe, expect, it } from "vitest";
import { POOL_NAMES } from "@/domain/pool";
import { KNOWN } from "../flow-palette";
import {
  PULSE_FOLDED_CLASS,
  pulseChainClasses,
  pulseNodeClass,
  pulsePoolClass,
} from "../pulse-palette";

/**
 * The page draws pools and chains side by side in one frame, unlike the cross-chain Sankey,
 * so the two colour vocabularies must not collide: an Ethereum ribbon in Ironwood's colour
 * would read as the pool.
 */

describe("pulsePoolClass", () => {
  it("keeps the site's own pool colours, so a pool reads the same here as on /analytics", () => {
    expect(pulsePoolClass("ironwood")).toBe("flow-1");
    expect(pulsePoolClass("sapling")).toBe("flow-2");
    expect(pulsePoolClass("orchard")).toBe("flow-4");
    expect(pulsePoolClass("sprout")).toBe("flow-rest");
  });
});

describe("pulseChainClasses", () => {
  it("gives every chain in one frame its own slot while slots remain", () => {
    // A hash cannot know what else is on screen; MAYA, LTC and NEAR would all hash to one
    // slot and the legend could not tell them apart.
    const frame = ["NEAR", "MAYA", "LTC", "BTC", "ETH"];
    const classes = pulseChainClasses(frame);
    const drawn = frame.map((c) => classes.get(c)!);
    expect(new Set(drawn).size).toBe(frame.length);
  });

  it("never gives a chain a pool's colour, over every ticker the site knows", () => {
    // Swept over `KNOWN` rather than a hand-picked few, because this is a property: a chain
    // in Ironwood's gold reads as the pool.
    const poolClasses = new Set(POOL_NAMES.map((p) => pulsePoolClass(p)));
    for (const value of pulseChainClasses(KNOWN).values()) {
      expect(poolClasses.has(value)).toBe(false);
    }
    // And one at a time, so a ticker that only ever appears alone is covered too.
    for (const ticker of KNOWN) {
      const alone = pulseChainClasses([ticker]).get(ticker)!;
      expect(poolClasses.has(alone)).toBe(false);
    }
  });

  it("keeps the five named chains on their fixed slots whatever else is in the frame", () => {
    // All five, not a sample: a fixed slot means a chain keeps its colour between visits.
    const classes = pulseChainClasses(["MAYA", "ETH", "LTC", "BTC", "SOL", "TRON", "NEAR"]);
    expect(classes.get("ETH")).toBe("flow-5");
    expect(classes.get("SOL")).toBe("flow-3");
    expect(classes.get("BTC")).toBe("flow-8");
    expect(classes.get("TRON")).toBe("flow-7");
    expect(classes.get("NEAR")).toBe("flow-6");
  });

  it("normalises a ticker's case and padding", () => {
    expect(pulseChainClasses([" eth "]).get("ETH")).toBe("flow-5");
  });

  it("assigns the unlisted chains deterministically, not in arrival order", () => {
    const one = pulseChainClasses(["MAYA", "LTC"]);
    const other = pulseChainClasses(["ltc", " maya "]);
    expect(one.get("MAYA")).toBe(other.get("MAYA"));
    expect(one.get("LTC")).toBe(other.get("LTC"));
  });

  it("folds the overflow into neutral ink rather than reusing a pool's slot", () => {
    // Six slots' worth of chains against five non-pool slots: the sixth takes the fold.
    const classes = pulseChainClasses(["ETH", "SOL", "BTC", "TRON", "NEAR", "MAYA"]);
    expect(classes.get("MAYA")).toBe(PULSE_FOLDED_CLASS);
  });

  it("draws an unnamed counterpart as the fold", () => {
    expect(pulseChainClasses(["UNKNOWN"]).get("UNKNOWN")).toBe(PULSE_FOLDED_CLASS);
  });
});

describe("pulseNodeClass", () => {
  const noFrame = new Map<string, string>();

  it("resolves a pool node", () => {
    expect(pulseNodeClass("orchard", noFrame)).toBe("flow-4");
  });

  it("takes the frame's slot for a chain the frame carries", () => {
    const classes = pulseChainClasses(["MAYA", "LTC"]);
    expect(pulseNodeClass("chain:MAYA", classes)).toBe(classes.get("MAYA"));
    expect(pulseNodeClass("chain:maya", classes)).toBe(classes.get("MAYA"));
  });

  it("draws a chain the frame folded in the tail's ink, never a slot colour", () => {
    // The map holds the chains that get their own node. A ticker absent from it lands on the
    // folded tail, so a slot colour would promise a distinction the picture does not draw.
    const classes = pulseChainClasses(["BTC", "ETH"]);
    expect(pulseNodeClass("chain:SOL", classes)).toBe(PULSE_FOLDED_CLASS);
    expect(pulseNodeClass("chain:BTC", classes)).toBe("flow-8");
    expect(pulseNodeClass("chain:eth", classes)).toBe("flow-5");
  });

  it("draws the ledger, the lockbox, issuance and the hub in neutral ink", () => {
    // None of them is a category to tell apart from another: they are places, and giving
    // them a slot colour would put them in the chains' vocabulary.
    expect(pulseNodeClass("transparent", noFrame)).toBe("text-ink-dim");
    expect(pulseNodeClass("lockbox", noFrame)).toBe("text-ink-dim");
    expect(pulseNodeClass("mined", noFrame)).toBe("text-ink-dim");
    expect(pulseNodeClass("hub", noFrame)).toBe("text-ink-dim");
  });
});
