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
  fee = 0n,
  lockbox: bigint | null = null,
): LedgerBlock => ({
  height,
  transparent_pool_zat: pool,
  lockbox_pool_zat: lockbox,
  total_fee_zat: fee,
});

/** A block: a coinbase paying `coinbase`, and a payment of 100 with fee 10 from a 110 input. */
function run(coinbase: bigint, mutate: (rows: LedgerIo[]) => void = () => {}, fee = 10n) {
  const checker = new LedgerChecker(block(H - 1, 1_000_000n));
  const cb = [row(1, "out", 0, coinbase)];
  const pay = [row(2, "in", 0, 110n), row(2, "out", 0, 100n)];
  mutate(pay);
  const delta = coinbase + 100n - 110n;
  checker.block(block(H, 1_000_000n + delta, fee), [
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
