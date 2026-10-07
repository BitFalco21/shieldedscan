import type { Transaction } from "@/domain";
import {
  ADDR_ALICE,
  ADDR_BOB,
  ADDR_FS_BOOTSTRAP,
  ADDR_FS_FOUNDATION,
  ADDR_FS_GRANTS,
  ADDR_MINER,
  ADDR_MINER_B,
  ADDR_MINER_C,
  ADDR_EXCHANGE,
  ADDR_UNNAMED,
  ADDR_VAULT,
  TIP_HEIGHT,
  TIP_TIME,
  fakeRawHex,
  hex64,
} from "./ids";

const BLOCK_INTERVAL = 75;

function ts(height: number): number {
  return TIP_TIME - (TIP_HEIGHT - height) * BLOCK_INTERVAL;
}

/** The containing block's fixture hash — same construction as blocks.ts. */
function blockHashAt(height: number): string {
  return hex64(`b${height}`);
}

/** Pools take turns, so the blocks list shows a chain with more than one miner in it. */
const MINERS = [ADDR_MINER, ADDR_MINER_B, ADDR_MINER_C];

/**
 * The one ZIP-213 height on the fixture chain: a coinbase that pays its funding streams
 * transparently and shields the miner's share into Orchard. It renders as
 * `MINED → TRANSPARENT ORCHARD`, a path no other fixture expresses, and exercises
 * `blockMiner`'s ZIP-213 branch, which returns `shielded` rather than naming a funding
 * stream as the miner.
 */
const ZIP213_COINBASE_HEIGHT = TIP_HEIGHT - 6;

/**
 * A Canopy-era coinbase: the 3.125 ZEC subsidy split 80% to the miner and 5/7/8% to the
 * three funding streams (ZIP 214), as exact zatoshi literals — no float arithmetic in a
 * ledger. With four payees, `blockMiner` has to pick the miner out, as on the real chain.
 */
function coinbase(height: number): Transaction {
  const miner = MINERS[height % MINERS.length] ?? ADDR_MINER;
  if (height === ZIP213_COINBASE_HEIGHT) {
    return {
      txid: hex64(`cb${height}`),
      blockHeight: height,
      blockHash: hex64(`b${height}`),
      timestamp: ts(height),
      isCoinbase: true,
      version: 5,
      sizeBytes: 1_104,
      lockTime: 0,
      expiryHeight: null,
      rawHex: null,
      feeZat: null,
      bindingSigValid: true,
      transparentInputs: [],
      // The streams keep their transparent outputs; only the miner's 80% is shielded.
      transparentOutputs: [
        { address: ADDR_FS_FOUNDATION, valueZat: 15_625_000 },
        { address: ADDR_FS_BOOTSTRAP, valueZat: 21_875_000 },
        { address: ADDR_FS_GRANTS, valueZat: 25_000_000 },
      ],
      sprout: null,
      sapling: null,
      orchard: { actions: 2, valueBalanceZat: 250_000_000 },
      ironwood: null,
    };
  }
  return {
    txid: hex64(`cb${height}`),
    blockHeight: height,
    blockHash: hex64(`b${height}`),
    timestamp: ts(height),
    isCoinbase: true,
    version: 5,
    sizeBytes: 312,
    lockTime: 0,
    expiryHeight: null,
    rawHex: null,
    feeZat: null,
    bindingSigValid: null,
    transparentInputs: [],
    transparentOutputs: [
      { address: miner, valueZat: 250_000_000 },
      { address: ADDR_FS_FOUNDATION, valueZat: 15_625_000 },
      { address: ADDR_FS_BOOTSTRAP, valueZat: 21_875_000 },
      { address: ADDR_FS_GRANTS, valueZat: 25_000_000 },
    ],
    sprout: null,
    sapling: null,
    orchard: null,
    ironwood: null,
  };
}

// Kept in sync with the block count in ./blocks.ts — every block needs a coinbase.
const BLOCK_COUNT = 40;
const HEIGHTS = Array.from({ length: BLOCK_COUNT }, (_, i) => TIP_HEIGHT - (BLOCK_COUNT - 1) + i);

const interesting: Transaction[] = [
  /**
   * Sprout unshielding (z→t), modelled on mainnet `750b0dc0…` in block 460,495, amounts
   * scaled down: `vpub_new` minus the transparent output is the 10,000 zat fee.
   *
   * Exercises Sprout's fee term, which lives on the JoinSplits rather than a bundle value
   * balance. `SproutBundle` carries only a JoinSplit count, which is why
   * `reportsValueBalance` excludes it and a Sprout-only transaction never renders a net
   * shielded figure.
   */
  {
    txid: hex64("750b0dc0"),
    blockHeight: TIP_HEIGHT - 3,
    blockHash: blockHashAt(TIP_HEIGHT - 3),
    timestamp: ts(TIP_HEIGHT - 3),
    isCoinbase: false,
    version: 4,
    sizeBytes: 1892,
    lockTime: 0,
    expiryHeight: null,
    rawHex: fakeRawHex(hex64("750b0dc0")),
    feeZat: 10_000,
    bindingSigValid: null,
    transparentInputs: [],
    transparentOutputs: [{ address: ADDR_ALICE, valueZat: 4_182_718_126_286 }],
    sprout: { joinSplits: 1 },
    sapling: null,
    orchard: null,
    ironwood: null,
  },
  /**
   * The one transaction whose direction is refused: transparent on both sides, Sapling spent,
   * Orchard gained. `txKindLabel` returns MIXED (the pools moved in opposite directions), and
   * `txFlowPath` returns null, so the cell falls back to a flat chip list with no arrow.
   *
   * Balances: 100 in, 30 back out transparently, 50 leaving Sapling and 119.9999 entering
   * Orchard, 0.0001 fee. Drawing `TRANSPARENT → ORCHARD SAPLING` would say Sapling gained
   * when it lost 50 ZEC.
   */
  {
    txid: hex64("c0ffee01"),
    blockHeight: TIP_HEIGHT - 1,
    blockHash: blockHashAt(TIP_HEIGHT - 1),
    timestamp: ts(TIP_HEIGHT - 1),
    isCoinbase: false,
    version: 5,
    sizeBytes: 2_104,
    lockTime: 0,
    expiryHeight: TIP_HEIGHT + 39,
    rawHex: fakeRawHex(hex64("c0ffee01")),
    feeZat: 10_000,
    bindingSigValid: true,
    transparentInputs: [{ address: ADDR_ALICE, valueZat: 10_000_000_000 }],
    transparentOutputs: [{ address: ADDR_BOB, valueZat: 3_000_000_000 }],
    sprout: null,
    sapling: { spends: 2, outputs: 1, valueBalanceZat: -5_000_000_000 },
    orchard: { actions: 4, valueBalanceZat: 11_999_990_000 },
    ironwood: null,
  },
  // Fully shielded Orchard z→z
  {
    txid: hex64("a3f29c4e"),
    blockHeight: TIP_HEIGHT,
    blockHash: blockHashAt(TIP_HEIGHT),
    timestamp: ts(TIP_HEIGHT),
    isCoinbase: false,
    version: 5,
    sizeBytes: 1843,
    lockTime: 0,
    expiryHeight: TIP_HEIGHT + 40,
    rawHex: fakeRawHex(hex64("a3f29c4e")),
    feeZat: 10_000,
    bindingSigValid: true,
    transparentInputs: [],
    transparentOutputs: [],
    sprout: null,
    sapling: null,
    orchard: { actions: 2, valueBalanceZat: -10_000 },
    ironwood: null,
  },
  // An Orchard → Ironwood pool migration, the turnstile shape NU6.3 introduced: renders the
  // source → destination badges. Balances net to the fee, as a migration must.
  {
    txid: hex64("22d8e411"),
    blockHeight: TIP_HEIGHT - 1,
    blockHash: blockHashAt(TIP_HEIGHT - 1),
    timestamp: ts(TIP_HEIGHT - 1),
    isCoinbase: false,
    version: 5,
    sizeBytes: 2210,
    lockTime: 0,
    expiryHeight: TIP_HEIGHT + 39,
    rawHex: fakeRawHex(hex64("22d8e411")),
    feeZat: 15_000,
    bindingSigValid: true,
    transparentInputs: [],
    transparentOutputs: [],
    sprout: null,
    sapling: null,
    orchard: { actions: 4, valueBalanceZat: -209_951_614_526 },
    ironwood: { actions: 2, valueBalanceZat: 209_951_599_526 },
  },
  // A two-source migration: Sapling AND Orchard drain into Ironwood in one transaction.
  // Modelled on mainnet `ea0a65f6…` (2,099.516 ZEC). Kept distinct from the row above
  // because `fromPools` is a list, and a single-source fixture never exercises that.
  {
    txid: hex64("ea0a65f6"),
    blockHeight: TIP_HEIGHT - 2,
    blockHash: blockHashAt(TIP_HEIGHT - 2),
    timestamp: ts(TIP_HEIGHT - 2),
    isCoinbase: false,
    version: 5,
    sizeBytes: 9484,
    lockTime: 0,
    expiryHeight: TIP_HEIGHT + 38,
    rawHex: fakeRawHex(hex64("ea0a65f6")),
    feeZat: 130_000,
    bindingSigValid: true,
    transparentInputs: [],
    transparentOutputs: [],
    sprout: null,
    sapling: { spends: 1, outputs: 2, valueBalanceZat: -10_554_966_347 },
    orchard: { actions: 22, valueBalanceZat: -199_396_763_179 },
    ironwood: { actions: 2, valueBalanceZat: 209_951_599_526 },
  },
  // Transparent
  {
    txid: hex64("77d10b12"),
    blockHeight: TIP_HEIGHT,
    blockHash: blockHashAt(TIP_HEIGHT),
    timestamp: ts(TIP_HEIGHT),
    isCoinbase: false,
    version: 5,
    sizeBytes: 421,
    lockTime: 0,
    expiryHeight: TIP_HEIGHT + 40,
    rawHex: fakeRawHex(hex64("77d10b12")),
    feeZat: 10_000,
    bindingSigValid: null,
    transparentInputs: [{ address: ADDR_ALICE, valueZat: 1_240_310_000 }],
    transparentOutputs: [
      { address: ADDR_BOB, valueZat: 1_240_210_000 },
      { address: ADDR_ALICE, valueZat: 90_000 },
    ],
    sprout: null,
    sapling: null,
    orchard: null,
    ironwood: null,
  },
  // Transparent, into a named address (an exchange deposit). One side carries a name and the
  // other does not, rendering both halves of `AddressLink`.
  {
    txid: hex64("d9051ce7"),
    blockHeight: TIP_HEIGHT - 2,
    blockHash: blockHashAt(TIP_HEIGHT - 2),
    timestamp: ts(TIP_HEIGHT - 2),
    isCoinbase: false,
    version: 5,
    sizeBytes: 297,
    lockTime: 0,
    expiryHeight: TIP_HEIGHT + 38,
    rawHex: fakeRawHex(hex64("d9051ce7")),
    feeZat: 10_000,
    bindingSigValid: null,
    transparentInputs: [{ address: ADDR_UNNAMED, valueZat: 500_010_000 }],
    transparentOutputs: [{ address: ADDR_EXCHANGE, valueZat: 500_000_000 }],
    sprout: null,
    sapling: null,
    orchard: null,
    ironwood: null,
  },
  // Mixed t→z shielding (the spec's flagship example)
  {
    txid: hex64("e09a44f7c21b88e0d3a6"),
    blockHeight: TIP_HEIGHT - 3,
    blockHash: blockHashAt(TIP_HEIGHT - 3),
    timestamp: ts(TIP_HEIGHT - 3),
    isCoinbase: false,
    version: 5,
    sizeBytes: 2143,
    lockTime: 0,
    expiryHeight: TIP_HEIGHT + 37,
    rawHex: fakeRawHex(hex64("e09a44f7c21b88e0d3a6")),
    feeZat: 100_000,
    bindingSigValid: true,
    transparentInputs: [
      { address: ADDR_ALICE, valueZat: 240_000_000 },
      { address: ADDR_ALICE, valueZat: 60_100_000 },
    ],
    transparentOutputs: [],
    sprout: null,
    sapling: null,
    orchard: { actions: 2, valueBalanceZat: 300_000_000 },
    ironwood: null,
  },
  // Fully shielded Sapling z→z
  {
    txid: hex64("bb61d803"),
    blockHeight: TIP_HEIGHT - 1,
    blockHash: blockHashAt(TIP_HEIGHT - 1),
    timestamp: ts(TIP_HEIGHT - 1),
    isCoinbase: false,
    version: 5,
    sizeBytes: 2820,
    lockTime: 0,
    expiryHeight: TIP_HEIGHT + 39,
    rawHex: fakeRawHex(hex64("bb61d803")),
    feeZat: 10_000,
    bindingSigValid: true,
    transparentInputs: [],
    transparentOutputs: [],
    sprout: null,
    sapling: { spends: 1, outputs: 2, valueBalanceZat: -10_000 },
    orchard: null,
    ironwood: null,
  },
  // Mixed z→t unshielding
  {
    txid: hex64("c4de5512"),
    blockHeight: TIP_HEIGHT - 5,
    blockHash: blockHashAt(TIP_HEIGHT - 5),
    timestamp: ts(TIP_HEIGHT - 5),
    isCoinbase: false,
    version: 5,
    sizeBytes: 1932,
    lockTime: 0,
    expiryHeight: TIP_HEIGHT + 35,
    rawHex: fakeRawHex(hex64("c4de5512")),
    feeZat: 10_000,
    bindingSigValid: true,
    transparentInputs: [],
    transparentOutputs: [{ address: ADDR_BOB, valueZat: 550_000_000 }],
    sprout: null,
    sapling: null,
    orchard: { actions: 3, valueBalanceZat: -550_010_000 },
    ironwood: null,
  },
  // Zcash leg of cross-chain out-transfer near-5510: Alice funds the vault ahead of a NEAR payout
  {
    txid: hex64("aa07"),
    blockHeight: TIP_HEIGHT - 1,
    blockHash: blockHashAt(TIP_HEIGHT - 1),
    timestamp: ts(TIP_HEIGHT - 1),
    isCoinbase: false,
    version: 5,
    sizeBytes: 438,
    lockTime: 0,
    expiryHeight: TIP_HEIGHT + 39,
    rawHex: fakeRawHex(hex64("aa07")),
    feeZat: 100_000,
    bindingSigValid: null,
    transparentInputs: [{ address: ADDR_ALICE, valueZat: 1_620_500_000 }],
    transparentOutputs: [
      { address: ADDR_VAULT, valueZat: 1_620_000_000 },
      { address: ADDR_ALICE, valueZat: 400_000 },
    ],
    sprout: null,
    sapling: null,
    orchard: null,
    ironwood: null,
  },
  // Zcash delivery leg of cross-chain in-transfer near-5502: the vault pays Bob after NEAR settlement
  {
    txid: hex64("aa01"),
    blockHeight: TIP_HEIGHT - 5,
    blockHash: blockHashAt(TIP_HEIGHT - 5),
    timestamp: ts(TIP_HEIGHT - 5),
    isCoinbase: false,
    version: 5,
    sizeBytes: 402,
    lockTime: 0,
    expiryHeight: TIP_HEIGHT + 35,
    rawHex: fakeRawHex(hex64("aa01")),
    feeZat: 100_000,
    bindingSigValid: null,
    transparentInputs: [{ address: ADDR_VAULT, valueZat: 3_820_100_000 }],
    transparentOutputs: [{ address: ADDR_BOB, valueZat: 3_820_000_000 }],
    sprout: null,
    sapling: null,
    orchard: null,
    ironwood: null,
  },
];

export const transactions: Transaction[] = [...HEIGHTS.map(coinbase), ...interesting];

export const transactionsById = new Map(transactions.map((t) => [t.txid, t]));
