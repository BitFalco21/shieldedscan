import { describe, expect, it } from "vitest";
import {
  ADDRESS_LABELS,
  BRIDGE_LABELS,
  LABEL_EXCHANGE,
  OTHER_LABELS,
  exchangeFlowsOf,
  labelGroupOf,
  type LabelFlowTx,
  type LabelGroup,
} from "@/domain";

const GROUPS: Record<string, LabelGroup> = {
  bA: { kind: "exchange", exchange: "binance" },
  bB: { kind: "exchange", exchange: "binance" },
  kA: { kind: "exchange", exchange: "kraken" },
  nI: { kind: "bridge" },
  gT: { kind: "other" },
};
const groupOf = (a: string) => GROUPS[a] ?? null;

const tx = (over: Partial<LabelFlowTx> & { deltas: LabelFlowTx["deltas"] }): LabelFlowTx => ({
  txid: "t1",
  height: 100,
  timestamp: 1_700_000_000,
  isCoinbase: false,
  poolsGaveZat: 0,
  poolsTookZat: 0,
  unlabelledInZat: 0,
  unlabelledOutZat: 0,
  ...over,
});

const flows = (t: LabelFlowTx) => exchangeFlowsOf(t, groupOf).flows;

describe("exchangeFlowsOf", () => {
  it("counts a customer deposit as an inflow from transparent addresses, the fee paid by the sender", () => {
    expect(
      flows(tx({ unlabelledInZat: 1_000, deltas: [{ address: "bA", deltaZat: 990 }] })),
    ).toEqual([
      expect.objectContaining({
        exchange: "binance",
        direction: "in",
        zat: 990,
        parts: [{ kind: "transparent", zat: 990 }],
      }),
    ]);
  });

  it("nets change returned to the exchange, and shows the fee it paid as its own part", () => {
    // Spends 10,000 from one wallet, pays 3,000 out and 6,990 back to another Binance wallet.
    expect(
      flows(
        tx({
          unlabelledOutZat: 3_000,
          deltas: [
            { address: "bA", deltaZat: -10_000 },
            { address: "bB", deltaZat: 6_990 },
          ],
        }),
      ),
    ).toEqual([
      expect.objectContaining({
        direction: "out",
        zat: 3_010,
        parts: [
          { kind: "transparent", zat: 3_000 },
          { kind: "fee", zat: 10 },
        ],
      }),
    ]);
  });

  it("sets a move between one exchange's own wallets apart as internal, with its fee", () => {
    const r = exchangeFlowsOf(
      tx({
        deltas: [
          { address: "bA", deltaZat: -5_000 },
          { address: "bB", deltaZat: 4_990 },
        ],
      }),
      groupOf,
    );
    expect(r.flows).toEqual([]);
    expect(r.internal).toEqual([{ exchange: "binance", feeZat: 10 }]);
  });

  it("splits a withdrawal by exact amounts when the exchange alone paid", () => {
    // Binance pays Kraken 60, a customer 39.99 and the fee: one batch, every amount on the chain.
    const [binance, kraken] = flows(
      tx({
        unlabelledOutZat: 3_999,
        deltas: [
          { address: "bA", deltaZat: -10_000 },
          { address: "kA", deltaZat: 6_000 },
        ],
      }),
    );
    expect(binance).toEqual(
      expect.objectContaining({
        direction: "out",
        zat: 10_000,
        parts: [
          { kind: "transparent", zat: 3_999 },
          { kind: "exchange", exchange: "kraken", zat: 6_000 },
          { kind: "fee", zat: 1 },
        ],
      }),
    );
    // Kraken sees the same 6,000 from Binance, so the two sides agree.
    expect(kraken).toEqual(
      expect.objectContaining({
        direction: "in",
        zat: 6_000,
        parts: [{ kind: "exchange", exchange: "binance", zat: 6_000 }],
      }),
    );
  });

  it("calls a flow mixed only when parties on both sides make the split unknowable", () => {
    // Binance and a customer both pay in; Kraken and another customer both receive.
    const out = flows(
      tx({
        unlabelledInZat: 500,
        unlabelledOutZat: 400,
        deltas: [
          { address: "bA", deltaZat: -2_000 },
          { address: "kA", deltaZat: 2_090 },
        ],
      }),
    );
    expect(out.find((f) => f.exchange === "binance")!.parts).toEqual([
      { kind: "mixed", zat: 2_000 },
    ]);
    expect(out.find((f) => f.exchange === "kraken")!.parts).toEqual([
      { kind: "mixed", zat: 2_090 },
    ]);
  });

  it("counts pools by the way they moved, not by being present", () => {
    // Value leaving a pool into Kraken is a source; a pool taking value is not.
    expect(
      flows(tx({ poolsGaveZat: 100, deltas: [{ address: "kA", deltaZat: 100 }] }))[0]!.parts,
    ).toEqual([{ kind: "shielded", zat: 100 }]);
    // A ZIP-213 coinbase paying Kraken transparently and shielding the rest: mined, not mixed.
    expect(
      flows(
        tx({ isCoinbase: true, poolsTookZat: 500, deltas: [{ address: "kA", deltaZat: 100 }] }),
      )[0]!.parts,
    ).toEqual([{ kind: "mined", zat: 100 }]);
  });

  it("names bridges and other labels as their own kinds", () => {
    const part = (t: LabelFlowTx) => flows(t)[0]!.parts[0]!.kind;
    expect(
      part(
        tx({
          deltas: [
            { address: "nI", deltaZat: -100 },
            { address: "kA", deltaZat: 100 },
          ],
        }),
      ),
    ).toBe("bridge");
    expect(
      part(
        tx({
          deltas: [
            { address: "gT", deltaZat: -100 },
            { address: "kA", deltaZat: 100 },
          ],
        }),
      ),
    ).toBe("other-labelled");
  });

  it("treats a stored address this build has no label for as another labelled party", () => {
    // Labelled by a newer build: never dropped, never counted as transparent.
    expect(
      flows(
        tx({
          deltas: [
            { address: "zz", deltaZat: -100 },
            { address: "kA", deltaZat: 100 },
          ],
        }),
      )[0]!.parts,
    ).toEqual([{ kind: "other-labelled", zat: 100 }]);
  });

  it("never leaves a part negative when the fee exceeds the largest source", () => {
    // 6,000 transparent and 5,000 from a pool fund a 1,000 deposit: a 10,000 fee.
    const parts = flows(
      tx({
        unlabelledInZat: 6_000,
        poolsGaveZat: 5_000,
        deltas: [{ address: "kA", deltaZat: 1_000 }],
      }),
    )[0]!.parts;
    expect(parts.every((p) => p.zat > 0)).toBe(true);
    expect(parts.reduce((s, p) => s + p.zat, 0)).toBe(1_000);
  });

  it("splits generated transactions into parts that add up and are never negative", () => {
    // Transactions obeying the balance identity: everything in = everything out + fee.
    let seed = 7;
    const rand = (max: number) => ((seed = (seed * 48271) % 2147483647) % max) + 0;
    const addrs = ["bA", "bB", "kA", "nI", "gT"];
    for (let i = 0; i < 3_000; i += 1) {
      const deltas = addrs
        .filter(() => rand(3) === 0)
        .map((address) => ({ address, deltaZat: (rand(2) ? 1 : -1) * (1 + rand(10_000)) }));
      const unlabelledInZat = rand(2) ? rand(10_000) : 0;
      const poolsGaveZat = rand(4) === 0 ? rand(10_000) : 0;
      const gave =
        unlabelledInZat + poolsGaveZat + deltas.reduce((s, d) => s + Math.max(0, -d.deltaZat), 0);
      const tookLabelled = deltas.reduce((s, d) => s + Math.max(0, d.deltaZat), 0);
      const open = gave - tookLabelled;
      if (open < 0) continue;
      // A third of the time the fee takes all the rest, leaving the labelled receivers alone on
      // their side (the exact-split branch); otherwise small fees, sometimes larger than any source.
      const fee = rand(3) === 0 ? open : rand(2) ? Math.min(open, rand(50)) : rand(open + 1);
      const rest = open - fee;
      const poolsTookZat = rand(4) === 0 ? rand(rest + 1) : 0;
      const t = tx({
        unlabelledInZat,
        poolsGaveZat,
        poolsTookZat,
        unlabelledOutZat: rest - poolsTookZat,
        deltas,
      });
      for (const f of flows(t)) {
        expect(
          f.parts.reduce((s, p) => s + p.zat, 0),
          JSON.stringify(t),
        ).toBe(f.zat);
        expect(
          f.parts.every((p) => p.zat > 0),
          JSON.stringify(t),
        ).toBe(true);
      }
    }
  });

  it("adds every flow's parts up to the flow", () => {
    const cases = [
      tx({ unlabelledInZat: 1_000, deltas: [{ address: "bA", deltaZat: 990 }] }),
      tx({
        unlabelledOutZat: 3_999,
        deltas: [
          { address: "bA", deltaZat: -10_000 },
          { address: "kA", deltaZat: 6_000 },
        ],
      }),
      tx({ unlabelledInZat: 700, poolsGaveZat: 400, deltas: [{ address: "kA", deltaZat: 1_090 }] }),
    ];
    for (const c of cases)
      for (const f of flows(c))
        expect(
          f.parts.reduce((s, p) => s + p.zat, 0),
          f.exchange,
        ).toBe(f.zat);
  });
});

describe("labelGroupOf", () => {
  it("decides a group for every label name: an exchange, a bridge or other", () => {
    for (const [address, label] of Object.entries(ADDRESS_LABELS)) {
      const g = labelGroupOf(address)!;
      expect(g, address).not.toBeNull();
      if (g.kind === "exchange") expect(LABEL_EXCHANGE[label.name], label.name).toBe(g.exchange);
    }
  });

  it("decides every label that is not an exchange's as a bridge or another labelled party", () => {
    for (const [name, mapped] of Object.entries(LABEL_EXCHANGE)) {
      if (typeof mapped === "string") continue;
      expect(BRIDGE_LABELS.has(name) || OTHER_LABELS.has(name), name).toBe(true);
    }
  });

  it("counts a theft-flagged address under no exchange", () => {
    const flagged = Object.entries(ADDRESS_LABELS).find(([, l]) => l.flag !== undefined)!;
    expect(labelGroupOf(flagged[0])!.kind).toBe("other");
  });

  it("groups Unit's deposit addresses and the NEAR Intents wallet as bridges", () => {
    const names = new Set(
      Object.keys(ADDRESS_LABELS)
        .filter((a) => labelGroupOf(a)!.kind === "bridge")
        .map((a) => ADDRESS_LABELS[a]!.name),
    );
    expect([...names].sort()).toEqual([
      "Hyperunit Deposit",
      "Hyperunit Hot Wallet",
      "NEAR Intents Bridge Hot Wallet",
    ]);
  });
});
