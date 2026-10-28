import { describe, expect, it } from "vitest";
import { NU7_HEIGHT } from "@/domain";
import { behindTipBlocks, rawReleaseGroups, type StoredBlock } from "../netmap/releases";

/**
 * "Behind the tip" is a span of time, so it means the same either side of NU7: 12½ minutes is 10
 * blocks at 75 seconds and 30 at 25.
 */
describe("behindTipBlocks", () => {
  it("is 10 blocks before NU7 and 30 from it", () => {
    expect(behindTipBlocks(NU7_HEIGHT - 1)).toBe(10);
    expect(behindTipBlocks(NU7_HEIGHT)).toBe(30);
  });
});

describe("rawReleaseGroups", () => {
  // Our follower stored one block a second for the test's purposes; only the heights matter.
  const blocks = (top: number): StoredBlock[] =>
    Array.from({ length: 50 }, (_, i) => ({ height: top - 49 + i, receivedAt: 1_000 + i }));
  const node = (bestHeight: number) => ({
    user_agent: "/Zakura:1.7.0/",
    protocol_version: 170_190,
    best_height: bestHeight,
    last_reachable: 1_049,
  });

  it("counts a node 20 blocks back as behind before NU7, and not after", () => {
    const before = NU7_HEIGHT - 100;
    expect(rawReleaseGroups([node(before - 20)], blocks(before))[0]!.behindTip).toBe(1);
    const after = NU7_HEIGHT + 1_000;
    expect(rawReleaseGroups([node(after - 20)], blocks(after))[0]!.behindTip).toBe(0);
    expect(rawReleaseGroups([node(after - 31)], blocks(after))[0]!.behindTip).toBe(1);
  });
});
