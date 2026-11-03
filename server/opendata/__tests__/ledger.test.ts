import { describe, expect, it } from "vitest";
import { NU7_HEIGHT } from "@/domain/halving";
import { LedgerChecker, type LedgerBlock, type LedgerIo, type LedgerTx } from "../ledger";

const H = 2_000_000; // 3.125 ZEC per block
const SUBSIDY = 312_500_000n;
const id = (n: number) => n.toString(16).padStart(64, "0");

const tx = (n: number, over: Partial<LedgerTx> = {}): LedgerTx => ({
  txid: id(n),
  block_height: H,
  kind: "transparent",
  fee_zat: 0n,
  sprout_joinsplits: null,
  sprout_vpub_net_zat: 0n,
  sapling_value_balance_zat: null,
  orchard_value_balance_zat: null,
  ironwood_value_balance_zat: null,
  binding_sig_valid: null,
  ...over,
});

const row = (n: number, io: "in" | "out", ordinal: number, value: bigint | null): LedgerIo => ({
  txid: id(n),
  block_height: H,
  io,
  ordinal,
  address: "t1x",
  value_zat: value,
  script_type: "pubkeyhash",
  prev_txid: io === "in" ? id(999) : null,
  prev_vout: io === "in" ? 0 : null,
});

const block = (
  height: number,
  pool: bigint,
  fee: bigint | null = 0n,
  lockbox: bigint | null = null,
  over: Partial<LedgerBlock> = {},
): LedgerBlock => ({
  height,
  total_fee_zat: fee,
  transparent_pool_zat: pool,
  sprout_pool_zat: null,
  sapling_pool_zat: 5_000n,
  orchard_pool_zat: null,
  lockbox_pool_zat: lockbox,
  ironwood_pool_zat: null,
  ...over,
});

/** A block: a coinbase paying `coinbase`, and a payment of 100 with fee 10 from a 110 input. */
function run(
  coinbase: bigint,
  mutate: (rows: LedgerIo[]) => void = () => {},
  fee: bigint | null = 10n,
  over: Partial<LedgerBlock> = {},
) {
  const checker = new LedgerChecker(block(H - 1, 1_000_000n));
  const cb = [row(1, "out", 0, coinbase)];
  const pay = [row(2, "in", 0, 110n), row(2, "out", 0, 100n)];
  mutate(pay);
  const delta = coinbase + 100n - 110n;
  checker.block(block(H, 1_000_000n + delta, fee, null, over), [
    { tx: tx(1, { kind: "coinbase", fee_zat: null }), ins: [], outs: cb },
    {
      tx: tx(2, { fee_zat: fee }),
      ins: pay.filter((r) => r.io === "in"),
      outs: pay.filter((r) => r.io === "out"),
    },
  ]);
  return checker;
}

describe("LedgerChecker", () => {
  it("accepts a block whose ledger, pool and coinbase agree", () => {
    const c = run(SUBSIDY + 10n);
    expect(c.failures.list()).toEqual([]);
    expect(c.underclaimZat).toBe(0n);
  });

  it("counts a coinbase that left value unclaimed, and fails one that claimed too much", () => {
    const under = run(SUBSIDY);
    expect(under.failures.list()).toEqual([]);
    expect([under.underclaimZat, under.underclaimedBlocks]).toEqual([10n, 1]);
    expect(
      run(SUBSIDY + 11n)
        .failures.list()
        .join(),
    ).toMatch(/claimed more than the subsidy/);
  });

  it("fails a ledger value that disagrees with the pool or the fee", () => {
    const c = run(SUBSIDY + 10n, (rows) => (rows[1]!.value_zat = 101n));
    expect(c.failures.list().join()).toMatch(/transparent pool change differs from the ledger/);
    expect(c.failures.list().join()).toMatch(/fee differs from the transaction's value balance/);
  });

  it("fails an input without a value, and a gap in ordinals", () => {
    expect(
      run(SUBSIDY + 10n, (rows) => (rows[0]!.value_zat = null))
        .failures.list()
        .join(),
    ).toMatch(/input without a value/);
    expect(
      run(SUBSIDY + 10n, (rows) => (rows[1]!.ordinal = 1))
        .failures.list()
        .join(),
    ).toMatch(/ordinals not contiguous/);
  });

  it("counts six tenths of fees into the NSM from NU7, as part of what the coinbase may claim", () => {
    const checker = new LedgerChecker(block(NU7_HEIGHT - 1, 0n));
    // 1,000 zat of fees: 600 to the NSM, so the coinbase may claim subsidy + 400.
    const subsidy = BigInt(Math.floor(156_250_000 / 3));
    const outs = [row(1, "out", 0, subsidy + 400n)];
    checker.block(block(NU7_HEIGHT, subsidy + 400n, 1_000n), [
      { tx: tx(1, { kind: "coinbase", fee_zat: null, block_height: NU7_HEIGHT }), ins: [], outs },
    ]);
    expect(checker.failures.list()).toEqual([]);
    expect(checker.underclaimZat).toBe(0n);
  });

  it("reads a lockbox disbursement as value moving, not as claimed subsidy", () => {
    // The NU6.1 boundary: 78,750 ZEC leave the lockbox through the coinbase.
    const h = 3_146_400;
    const lockbox = 7_875_000_000_000n;
    const checker = new LedgerChecker(block(h - 1, 0n, 0n, lockbox));
    const subsidy = 156_250_000n;
    // Miner + streams take the subsidy less the lockbox's 12%, which stays in the lockbox.
    const lockboxShare = (subsidy * 12n) / 100n;
    const outs = [row(1, "out", 0, subsidy - lockboxShare + lockbox)];
    checker.block(block(h, subsidy - lockboxShare + lockbox, 0n, lockboxShare), [
      { tx: tx(1, { kind: "coinbase", fee_zat: null, block_height: h }), ins: [], outs },
    ]);
    expect(checker.failures.list()).toEqual([]);
  });
});

describe("a block without a fee total", () => {
  it("reads its underclaim from the pools before NU7: the same figure the fee gives", () => {
    const known = run(SUBSIDY);
    const unknown = run(SUBSIDY, () => {}, null);
    expect(unknown.failures.list()).toEqual([]);
    expect([unknown.underclaimZat, unknown.underclaimedBlocks, unknown.skippedBlocks]).toEqual([
      known.underclaimZat,
      1,
      0,
    ]);
    expect(known.underclaimZat).toBe(10n);
    expect(
      run(SUBSIDY + 11n, () => {}, null)
        .failures.list()
        .join(),
    ).toMatch(/pools grew by more than the subsidy/);
  });

  it("skips it where a pool starts or stops reporting, so its change is not known", () => {
    const c = run(SUBSIDY, () => {}, null, { orchard_pool_zat: 0n });
    expect([c.failures.list(), c.underclaimZat, c.skippedBlocks]).toEqual([[], 0n, 1]);
  });

  it("skips it from NU7, where the NSM's share of the fee is unknown", () => {
    const checker = new LedgerChecker(block(NU7_HEIGHT - 1, 0n));
    const subsidy = BigInt(Math.floor(156_250_000 / 3));
    const outs = [row(1, "out", 0, subsidy - 50n)];
    checker.block(block(NU7_HEIGHT, subsidy - 50n, null), [
      { tx: tx(1, { kind: "coinbase", fee_zat: null, block_height: NU7_HEIGHT }), ins: [], outs },
    ]);
    expect([checker.failures.list(), checker.underclaimZat, checker.skippedBlocks]).toEqual([
      [],
      0n,
      1,
    ]);
  });

  it("still counts the underclaim of a block whose transparent pool is unknown", () => {
    const c = run(SUBSIDY, () => {}, 10n, { transparent_pool_zat: null });
    expect([c.failures.list(), c.underclaimZat, c.skippedBlocks]).toEqual([[], 10n, 0]);
  });
});

describe("the ledger's text columns", () => {
  const part = (over: Partial<Record<string, unknown[]>> = {}) => {
    const c = new LedgerChecker(null);
    c.part({
      txid: [id(1), id(1), id(2)],
      block_height: [H, H, H + 1],
      io: ["in", "out", "out"],
      script_type: ["pubkeyhash", "nulldata", null],
      prev_txid: [id(9), null, null],
      ...over,
    });
    return c.failures.list().join("\n");
  };

  it("accepts the node's types, a type it may name later, and NULLs", () => {
    expect(part()).toBe("");
    expect(part({ script_type: ["witness_v1_taproot", "multisig", "nonstandard"] })).toBe("");
  });

  it("fails a value out of format, and names its height", () => {
    expect(part({ script_type: ["pubkeyhash", "Pay To Me", null] })).toMatch(
      /^malformed script_type: 1 \(e\.g\. 2000000\)/,
    );
    expect(part({ script_type: ["x".repeat(33), "nulldata", null] })).toMatch(
      /malformed script_type/,
    );
    expect(part({ io: ["in", "out", "inout"] })).toMatch(
      /io neither in nor out: 1 \(e\.g\. 2000001\)/,
    );
    expect(part({ txid: [id(1), id(1), "ABC"] })).toMatch(/malformed txid/);
    expect(part({ txid: [id(1), id(1), null] })).toMatch(/malformed txid/);
    expect(part({ prev_txid: ["F".repeat(64), null, null] })).toMatch(/malformed prev_txid/);
  });

  it("scans every text column but the address for anything shaped like an address", () => {
    // In format, and still an address: the second lock catches it.
    expect(part({ script_type: ["t1abcdefghijklmnopqrstuvwxyz", null, null] })).toMatch(
      /transparent_io\.script_type: a value looks like an address: 1 \(e\.g\. heights 2000000-2000001\)/,
    );
    expect(part()).not.toMatch(/address/);
  });
});
