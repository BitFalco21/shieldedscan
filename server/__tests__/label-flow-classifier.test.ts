import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  LABEL_FLOW_CLASSIFIER,
  exchangeFlowsOf,
  type LabelFlowTx,
  type LabelGroup,
} from "@/domain";
import { LABEL_FLOW_TX_SQL } from "../label-flows";

/**
 * Stored flows were classified by one version of `exchangeFlowsOf` and the SQL that reads a
 * transaction back for it. A build that changes either must bump `LABEL_FLOW_CLASSIFIER`, or its
 * readers would count flows the stored rows were not classified by. This pins both to the version.
 */
const DIGESTS: Record<string, string> = {
  "1": "678444cc55a699b1f1092f5d3eda75db42249c809dcae949878438baae0207db",
};

const GROUPS: Record<string, LabelGroup> = {
  bA: { kind: "exchange", exchange: "binance" },
  bB: { kind: "exchange", exchange: "binance" },
  kA: { kind: "exchange", exchange: "kraken" },
  gA: { kind: "exchange", exchange: "gemini" },
  nI: { kind: "bridge" },
  oT: { kind: "other" },
};

/** A fixed corpus of transactions obeying the balance identity, every shape included. */
function corpus(): LabelFlowTx[] {
  let seed = 11;
  const rand = (max: number) => (seed = (seed * 48271) % 2147483647) % max;
  const addrs = [...Object.keys(GROUPS), "zz"];
  const out: LabelFlowTx[] = [];
  for (let i = 0; out.length < 2_000; i += 1) {
    const deltas = addrs
      .filter(() => rand(3) === 0)
      .map((address) => ({ address, deltaZat: (rand(2) ? 1 : -1) * (1 + rand(10_000)) }));
    const isCoinbase = rand(20) === 0;
    const unlabelledInZat = isCoinbase ? 0 : rand(2) ? rand(10_000) : 0;
    const poolsGaveZat = rand(4) === 0 ? rand(10_000) : 0;
    const gave =
      unlabelledInZat + poolsGaveZat + deltas.reduce((s, d) => s + Math.max(0, -d.deltaZat), 0);
    const took = deltas.reduce((s, d) => s + Math.max(0, d.deltaZat), 0);
    const open = gave - took;
    if (open < 0 && !isCoinbase) continue;
    const rest = Math.max(0, open - (rand(2) ? rand(50) : 0));
    const poolsTookZat = rand(4) === 0 ? rand(rest + 1) : 0;
    out.push({
      txid: `t${i}`,
      height: i,
      timestamp: 1_700_000_000 + i,
      isCoinbase,
      poolsGaveZat,
      poolsTookZat,
      unlabelledInZat,
      unlabelledOutZat: rest - poolsTookZat,
      deltas,
    });
  }
  return out;
}

function digest(): string {
  const h = createHash("sha256");
  h.update(LABEL_FLOW_TX_SQL.replace(/\s+/g, " "));
  for (const t of corpus()) h.update(JSON.stringify(exchangeFlowsOf(t, (a) => GROUPS[a] ?? null)));
  return h.digest("hex");
}

describe("the stored-flow classifier version", () => {
  it("names exactly the classification this build makes", () => {
    const got = digest();
    expect(
      DIGESTS[LABEL_FLOW_CLASSIFIER],
      `exchangeFlowsOf or LABEL_FLOW_TX_SQL changed what a flow comes out as: bump LABEL_FLOW_CLASSIFIER and add ${got} under it`,
    ).toBe(got);
  });
});
