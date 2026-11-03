import { describe, expect, it } from "vitest";
import { MAX_TAG_LENGTH, decodeCoinbaseTag } from "@/data/chain/coinbase-tag";
import { base58checkEncode } from "@/domain/encoding/base58check";
import { scanStrings, type BlockRow } from "../checks";
import {
  CoinbaseChecker,
  isSanitisedCoinbaseTag,
  MiningConcentration,
  type MinerRow,
} from "../derived";

const address = (fill: number) =>
  base58checkEncode(Uint8Array.from([0x1c, 0xb8, ...new Array<number>(20).fill(fill)]));
const A = address(1);
const B = address(2);
const C = address(3);

const block = (over: Partial<BlockRow>): BlockRow =>
  ({ height: 10, timestamp: 0n, miner_kind: "transparent", ...over }) as BlockRow;
const miner = (over: Partial<MinerRow>): MinerRow => ({
  height: 10,
  timestamp: 0n,
  miner_address: A,
  coinbase_tag: "Foundry Zcash Pool",
  ...over,
});

describe("blocks_coinbase checks", () => {
  const failures = (b: Partial<BlockRow>, m: Partial<MinerRow> | undefined) => {
    const c = new CoinbaseChecker();
    c.push(block(b), m === undefined ? undefined : miner(m));
    return c.failures.list().join("\n");
  };

  it("passes a transparent payout, a shielded coinbase and a block without text", () => {
    expect(failures({}, {})).toBe("");
    expect(failures({ miner_kind: "shielded" }, { miner_address: null })).toBe("");
    expect(failures({ miner_kind: null }, { miner_address: null, coinbase_tag: null })).toBe("");
  });

  it("requires the row of the same block", () => {
    expect(failures({}, undefined)).toMatch(/out of step with blocks/);
    expect(failures({}, { height: 11 })).toMatch(/out of step with blocks/);
  });

  it("requires an address exactly when the miner is transparent", () => {
    expect(failures({}, { miner_address: null })).toMatch(/does not match miner_kind/);
    expect(failures({ miner_kind: "unknown" }, {})).toMatch(/does not match miner_kind/);
  });

  it("requires a mainnet t-address, and never echoes the value", () => {
    const testnet = base58checkEncode(Uint8Array.from([0x1d, 0x25, ...new Array<number>(20)]));
    for (const bad of ["t1" + "a".repeat(33), testnet, "javascript:alert(1)"]) {
      const out = failures({}, { miner_address: bad });
      expect(out).toMatch(/miner_address is not a mainnet t-address: 1 \(e\.g\. 10\)/);
      expect(out).not.toContain(bad);
    }
  });

  it("accepts every tag the parser can produce, and nothing else", () => {
    const pad = "a".repeat(MAX_TAG_LENGTH - 1);
    const hex = (s: string) => "03aabbcc" + Buffer.from(s, "utf8").toString("hex");
    for (const raw of ["🦓 Foundry\t\tPool", `${pad} b`, "x\u0000y‮z", " lead "]) {
      expect(isSanitisedCoinbaseTag(decodeCoinbaseTag(hex(raw))!)).toBe(true);
    }
    // The cap can cut just after a space: still the parser's own output.
    expect(decodeCoinbaseTag(hex(`${pad} b`))!.endsWith(" ")).toBe(true);
    for (const raw of ["", " lead", "two  spaces", "tab\there", "ctl\u0007", "a".repeat(121)]) {
      expect(isSanitisedCoinbaseTag(raw)).toBe(false);
    }
    expect(failures({}, { coinbase_tag: "bell\u0007" })).toMatch(/not in its sanitised form/);
  });

  it("exempts exactly its two text columns from the address scan", () => {
    const tag = ["see www.pool.example or @pool"];
    expect(scanStrings("blocks_coinbase", "coinbase_tag", tag)).toEqual([]);
    expect(scanStrings("blocks_coinbase", "miner_address", [A])).toEqual([]);
    expect(scanStrings("mining_daily", "coinbase_tag", tag)).toHaveLength(1);
    expect(scanStrings("blocks_coinbase", "miner", tag)).toHaveLength(1);
    expect(scanStrings("blocks_daily", "miner_address", [A])).toHaveLength(1);
    expect(scanStrings("nu7_capable_releases", "source_url", ["https://x.example/"])).toEqual([]);
    expect(scanStrings("nu7_capable_releases", "client", ["https://x.example/"])).toHaveLength(1);
  });
});

describe("mining_concentration_daily", () => {
  const D = (n: number) =>
    new Date(Date.UTC(2026, 0, 1) + n * 86_400_000).toISOString().slice(0, 10);

  it("shares the top addresses over every block, never attributing a hidden payee", () => {
    const m = new MiningConcentration();
    for (const [kind, addr, n] of [
      ["transparent", A, 4],
      ["transparent", B, 2],
      ["transparent", C, 1],
      ["shielded", null, 2],
      ["unknown", null, 1],
    ] as const) {
      for (let i = 0; i < n; i++) m.push(D(0), kind, addr);
    }
    expect(m.rows(D(0))).toEqual([
      {
        day: D(0),
        blocks: 10,
        transparent_blocks: 7,
        shielded_blocks: 2,
        no_address_blocks: 1,
        distinct_addresses: 3,
        top1_share: 0.4,
        top3_share: 0.7,
        top5_share: 0.7,
      },
    ]);
  });

  it("covers the 30 days ending each day, and drops the 31st", () => {
    const m = new MiningConcentration();
    m.push(D(0), "transparent", A);
    m.push(D(29), "transparent", B);
    m.push(D(30), "transparent", B);
    const rows = m.rows(D(30));
    expect(rows.map((r) => [r.day, r.blocks, r.distinct_addresses, r.top1_share])).toEqual([
      [D(0), 1, 1, 1],
      [D(29), 2, 2, 0.5],
      [D(30), 2, 1, 1],
    ]);
    expect(m.rows(D(29))).toHaveLength(2);
  });

  it("leaves shares unknown while an unrecorded miner is in the window, never computed without it", () => {
    const m = new MiningConcentration();
    m.push(D(0), null, null);
    m.push(D(0), "transparent", A);
    m.push(D(1), "transparent", A);
    m.push(D(30), "transparent", A);
    const rows = m.rows(D(30));
    expect(rows.map((r) => [r.blocks, r.distinct_addresses, r.top1_share, r.top5_share])).toEqual([
      [2, null, null, null],
      [3, null, null, null],
      [2, 1, 1, 1],
    ]);
    // A transparent kind without an address is no attribution either.
    const n = new MiningConcentration();
    n.push(D(0), "transparent", null);
    expect(n.rows(D(0))[0]).toMatchObject({ transparent_blocks: 0, top1_share: null });
  });

  it("gives the same rows from blocks one by one as from per-day payout rows", () => {
    const perBlock = new MiningConcentration();
    const perRow = new MiningConcentration();
    const days: [number, string, string | null, number][] = [
      [0, "transparent", A, 3],
      [0, "shielded", null, 1],
      [5, "transparent", B, 2],
      [40, "transparent", A, 1],
      [40, "unknown", null, 2],
    ];
    for (const [d, kind, addr, n] of days) {
      perRow.push(D(d), kind, addr, n);
      for (let i = 0; i < n; i++) perBlock.push(D(d), kind, addr);
    }
    expect(perBlock.rows(D(40))).toEqual(perRow.rows(D(40)));
  });
});
