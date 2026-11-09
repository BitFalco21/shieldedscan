import { describe, expect, it } from "vitest";
import { AgentTools } from "../tools";
import { ADDRESS_INFO, BLOCK, FIXTURE_NOW_MS, makeChain, makeV1 } from "../testing/fixture-world";

/**
 * Zeno and the mining pools: the `/miners` page's figures through `chain_activity`, and a pool's
 * reviewed name where the page prints it — on the payout address's own page and on the block it
 * mined — never on an address no review names.
 */

const FOUNDRY = "t1SqwRAAdSig6dE4EBPLonAait219VmkUjP";

const dispatch = async (
  name: string,
  args: Record<string, unknown>,
  world = makeV1({
    address: { ...ADDRESS_INFO, address: FOUNDRY },
    block: { ...BLOCK, miner: { kind: "transparent", address: FOUNDRY } },
  }),
) =>
  (
    await new AgentTools(world, makeChain(), () => FIXTURE_NOW_MS).dispatch(
      name,
      JSON.stringify(args),
    )
  ).content;

describe("chain_activity 'mining-pools' and 'nsm'", () => {
  it("reads the pools over the window asked for, with the note before the data", async () => {
    const content = await dispatch("chain_activity", { mode: "mining-pools", lastDays: 7 });
    expect(content).toMatch(/^<note source="GET \/v1\/analytics\/mining-pools\?window=7d">/);
    expect(content).toContain('"name": "ViaBTC"');
    expect(content).toMatch(/LOWER BOUND/);
    // The basis paragraph is the note's job, not read twice.
    expect(content).not.toContain('"basis": "A mining pool here');
  });

  it("reads a year as 1y and all of history as all, never both at once", async () => {
    expect(await dispatch("chain_activity", { mode: "mining-pools", lastDays: 365 })).toMatch(
      /^<note source="GET \/v1\/analytics\/mining-pools\?window=1y">/,
    );
    expect(await dispatch("chain_activity", { mode: "nsm", allTime: true })).toMatch(
      /^<note source="GET \/v1\/analytics\/nsm\?window=all">/,
    );
    expect(
      await dispatch("chain_activity", { mode: "mining-pools", allTime: true, lastDays: 30 }),
    ).toMatch(/not both/);
  });

  it("refuses a window the page does not serve, naming the mode that answers it", async () => {
    expect(await dispatch("chain_activity", { mode: "mining-pools", lastDays: 60 })).toMatch(
      /7, 30, 90 or 365.*allTime/,
    );
    expect(
      await dispatch("chain_activity", { mode: "nsm", from: "2026-01-01", to: "2026-02-01" }),
    ).toMatch(/use 'miners'/);
    expect(await dispatch("chain_activity", { mode: "mining-pools", groupBy: "day" })).toMatch(
      /pass miningPool/,
    );
  });

  it("reads one pool with its newest blocks, and a compact series", async () => {
    const one = await dispatch("chain_activity", { mode: "mining-pools", miningPool: "foundry" });
    expect(one).toContain('"name": "Foundry USA"');
    expect(one).toContain(FOUNDRY);
    const series = await dispatch("chain_activity", {
      mode: "mining-pools",
      groupBy: "month",
      miningPool: "foundry",
    });
    expect(series).toContain('"sharePct"');
    expect(series).not.toContain('"reward"');
  });

  it("splits the NSM balance into what it carried in and what fees added", async () => {
    const content = await dispatch("chain_activity", { mode: "nsm", lastDays: 7 });
    expect(content).toContain('"carriedIn"');
    expect(content).toContain('"fromFees"');
    expect(content).toMatch(/LARGER THAN THE FEES/);
  });
});

describe("a pool's name where the page prints it", () => {
  it("names the pool on its payout address and on the block it mined", async () => {
    const address = await dispatch("lookup_address", { address: FOUNDRY });
    expect(address).toMatch(/"miningPool": \{\s*"id": "foundry",\s*"name": "Foundry USA"/);
    const block = await dispatch("lookup_block", { heightOrHash: String(BLOCK.height) });
    expect(block).toMatch(/"miningPool": \{\s*"id": "foundry"/);
  });

  it("names nothing for an address no review names", async () => {
    const address = await dispatch("lookup_address", { address: ADDRESS_INFO.address }, makeV1());
    expect(address).not.toContain('"miningPool"');
  });
});
