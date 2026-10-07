import type { MempoolEntry, MempoolStats, Transaction } from "@/domain";
import { txKind } from "@/domain";
import { ADDR_ALICE, ADDR_BOB, TIP_HEIGHT, TIP_TIME, fakeRawHex, hex64 } from "./ids";

const EXPIRY = TIP_HEIGHT + 20;

/** Six pending transactions — none included in a block yet. */
export const mempoolTransactions: Transaction[] = [
  // Fully shielded Orchard z→z, received most recently
  {
    txid: hex64("dead01"),
    blockHeight: null,
    blockHash: null,
    timestamp: TIP_TIME - 15,
    isCoinbase: false,
    version: 5,
    sizeBytes: 1780,
    lockTime: 0,
    expiryHeight: EXPIRY,
    rawHex: fakeRawHex(hex64("dead01")),
    feeZat: 12_000,
    bindingSigValid: true,
    transparentInputs: [],
    transparentOutputs: [],
    sprout: null,
    sapling: null,
    orchard: { actions: 2, valueBalanceZat: -12_000 },
    ironwood: null,
  },
  // Fully shielded Sapling z→z
  {
    txid: hex64("dead02"),
    blockHeight: null,
    blockHash: null,
    timestamp: TIP_TIME - 40,
    isCoinbase: false,
    version: 5,
    sizeBytes: 2760,
    lockTime: 0,
    expiryHeight: EXPIRY,
    rawHex: fakeRawHex(hex64("dead02")),
    feeZat: 10_000,
    bindingSigValid: true,
    transparentInputs: [],
    transparentOutputs: [],
    sprout: null,
    sapling: { spends: 1, outputs: 2, valueBalanceZat: -10_000 },
    orchard: null,
    ironwood: null,
  },
  // Transparent t→t
  {
    txid: hex64("dead03"),
    blockHeight: null,
    blockHash: null,
    timestamp: TIP_TIME - 70,
    isCoinbase: false,
    version: 5,
    sizeBytes: 401,
    lockTime: 0,
    expiryHeight: EXPIRY,
    rawHex: fakeRawHex(hex64("dead03")),
    feeZat: 8_000,
    bindingSigValid: null,
    transparentInputs: [{ address: ADDR_ALICE, valueZat: 500_008_000 }],
    transparentOutputs: [{ address: ADDR_BOB, valueZat: 500_000_000 }],
    sprout: null,
    sapling: null,
    orchard: null,
    ironwood: null,
  },
  // Mixed t→z shielding
  {
    txid: hex64("dead04"),
    blockHeight: null,
    blockHash: null,
    timestamp: TIP_TIME - 100,
    isCoinbase: false,
    version: 5,
    sizeBytes: 1980,
    lockTime: 0,
    expiryHeight: EXPIRY,
    rawHex: fakeRawHex(hex64("dead04")),
    feeZat: 15_000,
    bindingSigValid: true,
    transparentInputs: [{ address: ADDR_ALICE, valueZat: 220_015_000 }],
    transparentOutputs: [],
    sprout: null,
    sapling: null,
    orchard: { actions: 2, valueBalanceZat: 220_000_000 },
    ironwood: null,
  },
  // Mixed z→t unshielding
  {
    txid: hex64("dead05"),
    blockHeight: null,
    blockHash: null,
    timestamp: TIP_TIME - 130,
    isCoinbase: false,
    version: 5,
    sizeBytes: 1890,
    lockTime: 0,
    expiryHeight: EXPIRY,
    rawHex: fakeRawHex(hex64("dead05")),
    feeZat: 11_000,
    bindingSigValid: true,
    transparentInputs: [],
    transparentOutputs: [{ address: ADDR_BOB, valueZat: 90_000_000 }],
    sprout: null,
    sapling: null,
    orchard: { actions: 2, valueBalanceZat: -90_011_000 },
    ironwood: null,
  },
  // Transparent, fee not yet known to this node
  {
    txid: hex64("dead06"),
    blockHeight: null,
    blockHash: null,
    timestamp: TIP_TIME - 160,
    isCoinbase: false,
    version: 5,
    sizeBytes: 372,
    lockTime: 0,
    expiryHeight: EXPIRY,
    rawHex: fakeRawHex(hex64("dead06")),
    feeZat: null,
    bindingSigValid: null,
    transparentInputs: [{ address: ADDR_BOB, valueZat: 42_000_000 }],
    transparentOutputs: [{ address: ADDR_ALICE, valueZat: 41_990_000 }],
    sprout: null,
    sapling: null,
    orchard: null,
    ironwood: null,
  },
];

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    const lo = sorted[mid - 1];
    const hi = sorted[mid];
    if (lo === undefined || hi === undefined) throw new Error("unreachable");
    return (lo + hi) / 2;
  }
  const middle = sorted[mid];
  if (middle === undefined) throw new Error("unreachable");
  return middle;
}

/**
 * The entries as the node's mempool would hold them, derived from the transactions above
 * rather than restated: `seenAt` is the timestamp, the fee rate is the fee against the
 * bytes, and dead06 spends an output of the still-pending dead03 — the dependency case
 * the table must render (it cannot be mined before its parent).
 */
export const mempoolEntries: MempoolEntry[] = mempoolTransactions.map((tx) => ({
  transaction: tx,
  seenAt: tx.timestamp,
  feeRateZatPerByte: tx.feeZat !== null && tx.sizeBytes > 0 ? tx.feeZat / tx.sizeBytes : 0,
  dependsOn: tx.txid === hex64("dead06") ? [hex64("dead03")] : [],
}));

const totalSizeBytes = mempoolTransactions.reduce((sum, t) => sum + t.sizeBytes, 0);
const nonNullFees = mempoolTransactions
  .map((t) => t.feeZat)
  .filter((fee): fee is number => fee !== null);
const feeRates = mempoolEntries
  .filter((e) => e.transaction.feeZat !== null)
  // Tenth-of-a-zat/byte precision, matching the server's summariseMempool.
  .map((e) => Math.round(e.feeRateZatPerByte * 10));

/**
 * Derived the same way the server derives them, including the composition — six pending
 * transactions, so the "sample" is exhaustive and `sampled` equals `pendingCount`.
 */
const kinds = mempoolTransactions.map(txKind);
const rateMedianTenths = median(feeRates);

export const mempoolStats: MempoolStats = {
  pendingCount: mempoolTransactions.length,
  totalSizeBytes,
  medianFeeZat: median(nonNullFees),
  medianFeeRateZatPerByte: rateMedianTenths === null ? null : rateMedianTenths / 10,
  composition: {
    sampled: kinds.length,
    transparent: kinds.filter((k) => k === "transparent").length,
    mixed: kinds.filter((k) => k === "mixed").length,
    shielded: kinds.filter((k) => k === "shielded").length,
    coinbase: kinds.filter((k) => k === "coinbase").length,
  },
};
