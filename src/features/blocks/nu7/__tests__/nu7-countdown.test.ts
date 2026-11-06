import { describe, expect, it } from "vitest";
import { NU7_HEIGHT, blockSummaryOf, type BlockSummary } from "@/domain";
import { blocks as fixtureBlocks } from "@/fixtures/blocks";
import {
  clockParts,
  activationEtaSeconds,
  blocksToGo,
  initialPhase,
  isNu7CountdownId,
  NU7_CHANGES,
  firstNu7Intervals,
  formatZecShort,
  heartbeatModel,
  mergeRecent,
  nextPhase,
} from "../nu7-countdown";

const T = 1_799_000_000;

function block(height: number, timestamp = T): BlockSummary {
  return { ...blockSummaryOf(fixtureBlocks[0]!), height, hash: `h${height}`, timestamp };
}

describe("which URL shows the countdown", () => {
  it("is the canonical activation height on mainnet only", () => {
    expect(isNu7CountdownId(String(NU7_HEIGHT), false)).toBe(true);
    expect(isNu7CountdownId(String(NU7_HEIGHT), true)).toBe(false);
    expect(isNu7CountdownId(`0${NU7_HEIGHT}`, false)).toBe(false);
    expect(isNu7CountdownId(String(NU7_HEIGHT + 1), false)).toBe(false);
    expect(isNu7CountdownId("0".repeat(64), false)).toBe(false);
  });
});

describe("the countdown math", () => {
  it("counts the blocks left and never below zero", () => {
    expect(blocksToGo(NU7_HEIGHT - 412)).toBe(412);
    expect(blocksToGo(NU7_HEIGHT)).toBe(0);
    expect(blocksToGo(NU7_HEIGHT + 3)).toBe(0);
  });

  it("estimates the activation at 75 s per block from the newest block's time", () => {
    expect(activationEtaSeconds(NU7_HEIGHT - 412, T)).toBe(T + 412 * 75);
    expect(activationEtaSeconds(NU7_HEIGHT, T)).toBe(T);
  });
});

describe("what changes", () => {
  it("reads the target and the miner's subsidy from the protocol schedule", () => {
    expect(NU7_CHANGES).toEqual({
      spacingBefore: 75,
      spacingAfter: 25,
      // `getblocksubsidy` either side of the activation: 80% of 1.5625 and of 0.52083333.
      minerBeforeZat: 125_000_000,
      minerAfterZat: 41_666_668,
    });
    expect(formatZecShort(NU7_CHANGES.minerBeforeZat)).toBe("1.25");
    expect(formatZecShort(NU7_CHANGES.minerAfterZat)).toBe("0.4167");
  });
});

describe("the heartbeat", () => {
  it("spikes once per real block in the last 40 minutes", () => {
    const tip = { height: NU7_HEIGHT - 412, lastBlockTimestamp: T };
    const model = heartbeatModel(
      [block(tip.height, T), block(tip.height - 1, T - 41 * 60)],
      tip,
      T + 10,
      2_400,
    );
    expect(model.spikes).toEqual([{ t: T, height: tip.height }]);
    expect(model.marker).toBeNull();
    expect(model.blocksLeft).toBe(412);
    expect(model.step).toBe(75);
    // The visible future holds a handful of 75 s ticks, all after now.
    expect(model.projected.length).toBeGreaterThan(3);
    expect(model.projected.every((t) => t > T + 10)).toBe(true);
  });

  it("marks the projected activation once it is in view, and waits at now when late", () => {
    const tip = { height: NU7_HEIGHT - 3, lastBlockTimestamp: T };
    expect(heartbeatModel([], tip, T, 2_400).marker).toBe(T + 3 * 75);
    expect(heartbeatModel([], tip, T + 600, 2_400).marker).toBe(T + 600);
    expect(heartbeatModel([], tip, T, 2_400).projected).not.toContain(T + 3 * 75);
  });

  it("follows a reorg: a new hash replaces the height, and blocks above the tip drop out", () => {
    const merged = mergeRecent(
      [block(10), block(11), block(12)],
      [{ ...block(11), hash: "x" }],
      11,
    );
    expect(merged.map((b) => [b.height, b.hash])).toEqual([
      [11, "x"],
      [10, "h10"],
    ]);
  });
});

describe("the transition", () => {
  it("animates only when the crossing was watched, and never under reduced motion", () => {
    expect(initialPhase(NU7_HEIGHT - 1)).toBe("counting");
    expect(initialPhase(NU7_HEIGHT)).toBe("awaiting");
    expect(nextPhase("counting", NU7_HEIGHT - 1, false)).toBe("counting");
    expect(nextPhase("counting", NU7_HEIGHT, false)).toBe("activating");
    expect(nextPhase("counting", NU7_HEIGHT, true)).toBe("awaiting");
    // A reorg back below the height does not undo an activation already shown.
    expect(nextPhase("awaiting", NU7_HEIGHT - 1, false)).toBe("awaiting");
  });
});

describe("the first NU7 blocks", () => {
  it("measures each block from its parent while the run is unbroken, negatives as they are", () => {
    const rows = firstNu7Intervals([
      block(NU7_HEIGHT + 2, T + 20),
      block(NU7_HEIGHT, T),
      block(NU7_HEIGHT + 1, T + 31),
      block(NU7_HEIGHT + 4, T + 80),
    ]);
    expect(rows).toEqual([
      { height: NU7_HEIGHT + 1, seconds: 31 },
      { height: NU7_HEIGHT + 2, seconds: -11 },
    ]);
  });

  it("is empty until a block after the activation exists", () => {
    expect(firstNu7Intervals([block(NU7_HEIGHT, T)])).toEqual([]);
    expect(firstNu7Intervals([])).toEqual([]);
  });
});

describe("clockParts", () => {
  it("splits the estimate into padded hours, minutes and seconds", () => {
    expect(clockParts(7 * 3_600 + 12 * 60 + 48)).toEqual([
      { label: "hrs", value: "07" },
      { label: "min", value: "12" },
      { label: "sec", value: "48" },
    ]);
  });

  it("adds days only when there is at least one", () => {
    expect(clockParts(86_400 + 61)?.map((p) => p.value)).toEqual(["01", "00", "01", "01"]);
  });

  it("is null once the estimate is due, never a negative clock", () => {
    expect(clockParts(0.4)).toBeNull();
    expect(clockParts(-30)).toBeNull();
  });
});
