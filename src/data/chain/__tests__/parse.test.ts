import { describe, expect, it } from "vitest";
import type { RpcBlock } from "../rpc-types";
import { classifyTxKind, computeFeeZat, parseBlock, reconcilePoolFlows } from "../parse";
import block3426950 from "../__fixtures__/block-3426950.json";
import block3426987 from "../__fixtures__/block-3426987.json";
import block3426998 from "../__fixtures__/block-3426998.json";
import block3428150 from "../__fixtures__/block-3428150.json";
import shieldedCoinbase from "../__fixtures__/block-3437300-coinbase.json";
import block460495 from "../__fixtures__/block-460495.json";

/**
 * Every assertion here is against a real capture from a synced node, not a hand-written
 * shape: parsers that are correct against documented shapes can still be wrong against
 * reality, and those bugs produce plausible output.
 */

const shielding = block3426950 as unknown as RpcBlock;
const unshielding = block3426987 as unknown as RpcBlock;
const orchardOnly = block3426998 as unknown as RpcBlock;

const byTxidPrefix = (b: RpcBlock, prefix: string) => {
  const parsed = parseBlock(b);
  const tx = parsed.transactions.find((t) => t.txid.startsWith(prefix));
  if (!tx) throw new Error(`fixture no longer contains a tx starting ${prefix}`);
  return tx;
};

describe("parseBlock", () => {
  it("maps block fields onto the domain shape", () => {
    const { block } = parseBlock(shielding);
    expect(block.height).toBe(3426950);
    expect(block.hash).toHaveLength(64);
    expect(block.prevHash).toHaveLength(64);
    expect(block.sizeBytes).toBe(34154);
    expect(block.txids).toHaveLength(9);
  });

  it("excludes coinbase from the activity buckets", () => {
    const { rollup } = parseBlock(shielding);
    // 9 transactions: 1 coinbase, 4 transparent, 3 mixed, 1 shielded. Folding coinbase into
    // "transparent" would add +1 per block and deflate every shielded-share figure.
    expect(rollup.transparentTxCount + rollup.mixedTxCount + rollup.shieldedTxCount).toBe(8);
    expect(rollup.transparentTxCount).toBe(4);
    expect(rollup.mixedTxCount).toBe(3);
    expect(rollup.shieldedTxCount).toBe(1);
  });

  it("counts a shielding transaction as mixed, not shielded", () => {
    // A t→z transfer has transparent inputs, so `txKind` calls it mixed: `shieldedTxCount`
    // counts only fully shielded (z→z) transactions, the reading the privacy shield grammar
    // also uses.
    const { rollup } = parseBlock(shielding);
    expect(classifyTxKind(byTxidPrefix(shielding, "5ff8c941"))).toBe("mixed");
    expect(classifyTxKind(byTxidPrefix(shielding, "478520e4"))).toBe("mixed");
    expect(rollup.shieldedTxCount).toBe(1);
  });

  it("reads the monitored pools and omits unmonitored ones", () => {
    const { rollup } = parseBlock(unshielding);
    // Ironwood is reported `monitored: false` until NU6.3 activates at height 3,428,143,
    // so it is absent rather than stored as a zero the node never claimed.
    expect(Object.keys(rollup.poolTotals).sort()).toEqual([
      "lockbox",
      "orchard",
      "sapling",
      "sprout",
      "transparent",
    ]);
    expect(rollup.poolTotals.ironwood).toBeUndefined();
  });
});

describe("value balance sign", () => {
  it("reports shielding as positive flow into the pool", () => {
    // 17 transparent inputs, zero transparent outputs, 2 Sapling outputs: unambiguously
    // value entering the pool. The RPC reports −2,125,762,600.
    const tx = byTxidPrefix(shielding, "5ff8c941");
    expect(tx.outputs).toHaveLength(0);
    expect(tx.inputRefs).toHaveLength(17);
    expect(tx.sapling?.valueBalanceZat).toBe(2_125_762_600);
    expect(tx.rpcSaplingVB).toBe(-2_125_762_600);
  });

  it("reports unshielding as negative flow out of the pool", () => {
    // Zero transparent inputs, one output, 1 Sapling spend: value leaving the pool.
    const tx = byTxidPrefix(unshielding, "9eeab556");
    expect(tx.inputRefs).toHaveLength(0);
    expect(tx.sapling?.valueBalanceZat).toBe(-625_538_079);
  });

  it("negates Orchard from its nested field, not the top-level one", () => {
    // This is the trap: reading top-level `valueBalanceZat` for both pools would report 0
    // here, because this transaction's Sapling balance genuinely is 0.
    const tx = byTxidPrefix(shielding, "37c94cb5");
    expect(tx.rpcSaplingVB).toBe(0);
    expect(tx.sapling).toBeNull();
    expect(tx.orchard?.valueBalanceZat).toBe(30_445_428);
  });
});

describe("reconcilePoolFlows", () => {
  it("matches the node's own pool deltas across both pools", () => {
    const result = reconcilePoolFlows(shielding, parseBlock(shielding));
    expect(result.ok).toBe(true);
    expect(result.saplingFromTxs).toBe(2_250_874_631);
    expect(result.orchardFromTxs).toBe(30_425_428);
  });

  it("fails loudly if the sign convention is inverted", () => {
    // Simulates the bug the invariant exists to catch: pool deltas flipped.
    const corrupted: RpcBlock = {
      ...shielding,
      valuePools: shielding.valuePools.map((p) => ({
        ...p,
        valueDeltaZat: p.valueDeltaZat === null ? null : -p.valueDeltaZat,
      })),
    };
    expect(reconcilePoolFlows(corrupted, parseBlock(shielding)).ok).toBe(false);
  });

  it("holds on a block whose only shielded activity is unshielding", () => {
    const result = reconcilePoolFlows(unshielding, parseBlock(unshielding));
    expect(result.ok).toBe(true);
    expect(result.saplingFromTxs).toBe(-625_538_079);
  });
});

describe("computeFeeZat", () => {
  it("derives the fee for a unshielding transaction", () => {
    // 0 transparent in + 625,538,079 − 625,523,079 = 15,000
    const tx = byTxidPrefix(unshielding, "9eeab556");
    expect(computeFeeZat(tx, 0)).toBe(15_000);
  });

  it("derives the fee for a fully shielded transaction", () => {
    // No transparent side at all: the entire value balance IS the fee, because the fee must
    // leave the shielded pool to reach the miner. Any "no transparent side ⇒ unknown" rule
    // would be wrong for the most private transactions on the chain.
    const tx = byTxidPrefix(shielding, "39f3453d");
    expect(tx.inputRefs).toHaveLength(0);
    expect(tx.outputs).toHaveLength(0);
    expect(computeFeeZat(tx, 0)).toBe(20_000);
  });

  it("returns null when an input could not be resolved", () => {
    const tx = byTxidPrefix(shielding, "5ff8c941");
    expect(computeFeeZat(tx, null)).toBeNull();
  });

  it("returns null for coinbase rather than 0", () => {
    const parsed = parseBlock(shielding);
    const coinbase = parsed.transactions.find((t) => t.isCoinbase);
    expect(coinbase).toBeDefined();
    expect(computeFeeZat(coinbase!, 0)).toBeNull();
  });
});

describe("transaction shape", () => {
  it("identifies coinbase structurally and emits no input refs for it", () => {
    const parsed = parseBlock(shielding);
    const coinbase = parsed.transactions.filter((t) => t.isCoinbase);
    expect(coinbase).toHaveLength(1);
    // The coinbase input references no previous output, so it must never enter resolution.
    expect(coinbase[0]?.inputRefs).toHaveLength(0);
  });

  it("leaves untouched pools null rather than zero-filled", () => {
    const tx = byTxidPrefix(shielding, "3761c46d");
    expect(tx.sprout).toBeNull();
    expect(tx.sapling).toBeNull();
    expect(tx.orchard).toBeNull();
  });

  it("classifies each branch using the domain classifier", () => {
    expect(classifyTxKind(byTxidPrefix(shielding, "3761c46d"))).toBe("transparent");
    expect(classifyTxKind(byTxidPrefix(shielding, "37c94cb5"))).toBe("mixed");
    // 17 transparent inputs and no transparent outputs: "mixed" proves the reduced shape
    // carries `inputRefs` across as transparent inputs.
    expect(classifyTxKind(byTxidPrefix(shielding, "5ff8c941"))).toBe("mixed");
    expect(classifyTxKind(byTxidPrefix(shielding, "39f3453d"))).toBe("shielded");
  });

  it("captures input refs as prevout pointers, since RPC gives no address or value", () => {
    const tx = byTxidPrefix(shielding, "5ff8c941");
    const ref = tx.inputRefs[0];
    expect(ref?.prevTxid).toHaveLength(64);
    expect(typeof ref?.prevVout).toBe("number");
  });

  it("keeps a single output address and reads the integer zatoshi field", () => {
    const tx = byTxidPrefix(unshielding, "9eeab556");
    const out = tx.outputs[0];
    expect(out?.valueZat).toBe(625_523_079);
    expect(out?.address).toMatch(/^t[13]/);
  });
});

describe("block header fields", () => {
  it("carries the header through, keeping nonce and bits as the hex the node sent", () => {
    const { block } = parseBlock(unshielding);
    expect(block.version).toBe(4);
    expect(block.bits).toBe("1c00e9e0");
    expect(block.difficulty).toBeCloseTo(146914688.75253874, 6);
    // 32 bytes, not a 32-bit counter: read as a number this would lose most of itself.
    expect(block.nonce).toHaveLength(64);
    expect(block.merkleRoot).toBe(
      "31e691855ade9462250eee824f9e1a09fdce1db8f2d0b42374b37fa12e67c5cc",
    );
    expect(block.finalSaplingRoot).toHaveLength(64);
    expect(block.finalOrchardRoot).toHaveLength(64);
  });

  it("reports an absent commitment root as null rather than an empty string", () => {
    const { finalsaplingroot, finalorchardroot, ...preSapling } = unshielding as RpcBlock & {
      finalsaplingroot?: string;
      finalorchardroot?: string;
    };
    void finalsaplingroot;
    void finalorchardroot;
    const { block } = parseBlock(preSapling as RpcBlock);
    expect(block.finalSaplingRoot).toBeNull();
    expect(block.finalOrchardRoot).toBeNull();
  });
});

describe("coinbase tag", () => {
  it("decodes the miner's message, emoji included", () => {
    // Block 3,426,987's coinbase carries a zebra (U+1F993) then the pool's name written as
    // raw bytes — no push prefix, which is why this filters bytes instead of parsing script.
    expect(parseBlock(unshielding).block.coinbaseTag).toBe(
      "🦓bdgjFoundry Zcash Pool #PrivacyMatters",
    );
  });

  it("keeps the emoji when the coinbase carries nothing else", () => {
    // 3,426,998's script is just the height push and the zebra: 03b64a3404f09fa693.
    expect(parseBlock(orchardOnly).block.coinbaseTag).toBe("🦓");
  });
});

describe("miner and funding streams", () => {
  it("separates the miner from the NU6 funding stream", () => {
    const { block } = parseBlock(shielding);
    // 1.25224743 ZEC to the miner; exactly 8% of the 1.5625 ZEC subsidy to the stream.
    expect(block.miner).toEqual({
      kind: "transparent",
      address: "t1MKn34KBa8Xh4g8qU8psibBXvURafphVn7",
    });
    expect(block.fundingStreams).toEqual([
      { address: "t3cFfPt1Bcvgez9ZbMBFWeZsskxTkPzGCow", valueZat: 12_500_000 },
    ]);
  });

  it("counts the whole coinbase payout as the block reward", () => {
    expect(parseBlock(shielding).block.blockRewardZat).toBe(137_724_743);
  });

  it("leaves fees unknown on the parse path, which cannot resolve inputs", () => {
    expect(parseBlock(shielding).block.totalFeeZat).toBeNull();
  });
});

describe("block composition", () => {
  it("counts every transaction, coinbase included, without resolving an input", () => {
    const { block } = parseBlock(unshielding);
    const { transparentTxs, mixedTxs, shieldedTxs } = block.composition;
    expect(transparentTxs + mixedTxs + shieldedTxs).toBe(block.txids.length);
  });
});

describe("transaction context fields", () => {
  it("carries locktime and the containing block's hash from the block path", () => {
    const parsed = parseBlock(unshielding);
    for (const tx of parsed.transactions) {
      // Every transaction in the four captures has locktime 0 — the observed value.
      expect(tx.lockTime).toBe(0);
      expect(tx.blockHash).toBe("00000000004a88a9f07e09a32b94082b8600c0b5625a371566763bb8a6f49732");
    }
  });

  it("never carries rawHex out of a block parse — that is the single-lookup path's field", () => {
    const parsed = parseBlock(unshielding);
    expect(parsed.transactions.every((tx) => !("rawHex" in tx))).toBe(true);
  });
});

/**
 * Ironwood (NU6.3), activated on mainnet at height 3,428,143.
 *
 * Block 3,428,150 is a real capture from shortly after activation. Six of its seven
 * transactions migrate Orchard value into Ironwood: `orchard.valueBalanceZat` is large and
 * positive while `ironwood.valueBalanceZat` is large and negative, so summing only the
 * first would read the migrated value as a payment to the miner.
 */
const ironwood = block3428150 as unknown as RpcBlock;

describe("ironwood", () => {
  it("derives the true fee for an Orchard → Ironwood migration", () => {
    // 3 ZEC migrated into Ironwood:
    //   orchard  +300,030,000 (RPC sign: leaving orchard)
    //   ironwood −300,000,000 (RPC sign: entering ironwood)
    //   fee = 0 + 0 + 300,030,000 + (−300,000,000) − 0 = 30,000
    // Omitting the Ironwood term would give 300,030,000.
    const tx = byTxidPrefix(ironwood, "25d87ba6");
    expect(tx.rpcOrchardVB).toBe(300_030_000);
    expect(tx.rpcIronwoodVB).toBe(-300_000_000);
    expect(computeFeeZat(tx, 0)).toBe(30_000);
  });

  it("keeps every migrating transaction's fee plausible", () => {
    // A blanket sanity check over the block: a Zcash fee is a few thousand zatoshis, so any
    // fee above 0.01 ZEC here would mean a value balance leaked into the fee again.
    const parsed = parseBlock(ironwood);
    const fees = parsed.transactions
      .filter((t) => !t.isCoinbase)
      .map((t) => computeFeeZat(t, 0))
      .filter((f): f is number => f !== null);
    expect(fees.length).toBeGreaterThan(0);
    for (const fee of fees) {
      expect(fee).toBeGreaterThan(0);
      expect(fee).toBeLessThan(1_000_000);
    }
  });

  it("negates the ironwood balance into the domain sign", () => {
    // Domain convention: positive = value ENTERING the pool. The RPC says the opposite.
    const tx = byTxidPrefix(ironwood, "25d87ba6");
    expect(tx.ironwood?.valueBalanceZat).toBe(300_000_000);
    expect(tx.ironwood?.actions).toBe(2);
  });

  it("reconciles ironwood against the node's own pool delta", () => {
    const result = reconcilePoolFlows(ironwood, parseBlock(ironwood));
    expect(result.ok).toBe(true);
    expect(result.ironwoodFromTxs).toBe(302_400_000);
    expect(result.orchardFromTxs).toBe(-302_530_000);
  });

  it("fails loudly if the ironwood balance stops being read", () => {
    // The regression guard: drop the bundle and reconciliation must complain, rather than
    // matching because nothing was summed on either side.
    const stripped: RpcBlock = {
      ...ironwood,
      tx: ironwood.tx.map((t) => ({ ...t, ironwood: undefined })),
    };
    expect(reconcilePoolFlows(stripped, parseBlock(stripped)).ok).toBe(false);
  });

  it("reports ironwood as a pool the transaction touched", () => {
    const tx = byTxidPrefix(ironwood, "25d87ba6");
    const parsed = parseBlock(ironwood);
    const shape = parsed.transactions.find((t) => t.txid === tx.txid);
    expect(shape?.ironwood).not.toBeNull();
    // Both pools, newest first — the badge column must name Ironwood, not just Orchard.
    expect(classifyTxKind(tx)).toBe("shielded");
  });

  it("stores the ironwood pool total now that the node monitors it", () => {
    // Pre-activation the node reported `monitored: false` and the total was omitted, so it
    // stored as NULL rather than a zero the node never claimed. That flipped on activation.
    const { rollup } = parseBlock(ironwood);
    expect(rollup.poolTotals.ironwood).toBe(2_321_766_586);
  });
});

/**
 * Sprout: its public values live on each JoinSplit as `vpub_old`/`vpub_new` rather than in
 * a `valueBalanceZat` field, and omitting them from the fee equation yields impossible
 * negative fees.
 *
 * Block 460,495 is a real capture holding two Sprout unshielding transactions; without the
 * Sprout term each would derive a fee of exactly minus its own transparent output.
 */
const sprout = block460495 as unknown as RpcBlock;

describe("sprout", () => {
  it("derives the true fee for a Sprout unshielding transaction", () => {
    //   vpub_new 4,182,718,136,286 (RPC sign: leaving sprout)
    //   vpub_old             0
    //   transparent out 4,182,718,126,286
    //   fee = 0 + 4,182,718,136,286 − 4,182,718,126,286 = 10,000
    const tx = byTxidPrefix(sprout, "750b0dc0");
    expect(tx.rpcSproutVB).toBe(4_182_718_136_286);
    expect(computeFeeZat(tx, 0)).toBe(10_000);
  });

  it("derives the same default fee for the block's other Sprout transaction", () => {
    const tx = byTxidPrefix(sprout, "b11804ef");
    expect(tx.rpcSproutVB).toBe(4_000_010_000);
    expect(computeFeeZat(tx, 0)).toBe(10_000);
  });

  it("never derives a negative fee for a transaction with no transparent inputs", () => {
    // A fee below zero is not a small error but a sign that a term is missing entirely.
    //
    // Scoped to transactions with no transparent inputs, because only there is a transparent
    // input total of 0 a fact: this block also carries ordinary transparent transactions whose
    // real inputs live in earlier blocks, and passing 0 for those would manufacture a negative
    // fee.
    const parsed = parseBlock(sprout);
    const fees = parsed.transactions
      .filter((t) => !t.isCoinbase && t.inputRefs.length === 0)
      .map((t) => computeFeeZat(t, 0))
      .filter((f): f is number => f !== null);
    expect(fees.length).toBe(2);
    for (const fee of fees) {
      expect(fee).toBeGreaterThanOrEqual(0);
      expect(fee).toBeLessThan(1_000_000);
    }
  });

  it("fails loudly if the joinsplit public values stop being read", () => {
    // The regression guard: empty the JoinSplits and the fee must go wrong. Otherwise
    // re-typing `vjoinsplit` as `unknown[]` would leave every modern fixture green.
    const stripped: RpcBlock = {
      ...sprout,
      tx: sprout.tx.map((t) => ({ ...t, vjoinsplit: [] })),
    };
    const tx = byTxidPrefix(stripped, "750b0dc0");
    expect(tx.rpcSproutVB).toBe(0);
    expect(computeFeeZat(tx, 0)).toBe(-4_182_718_126_286);
  });

  it("reads zero on a modern transaction that never touches sprout", () => {
    expect(byTxidPrefix(ironwood, "25d87ba6").rpcSproutVB).toBe(0);
    expect(byTxidPrefix(unshielding, "9eeab556").rpcSproutVB).toBe(0);
  });

  it("still reports sprout as a touched pool by joinsplit count", () => {
    // The count must keep working: `SproutBundle` is how the UI knows to show the pool, and
    // Sprout publishes no per-bundle balance, which is why `reportsValueBalance` excludes it.
    const tx = byTxidPrefix(sprout, "750b0dc0");
    expect(tx.sprout).toEqual({ joinSplits: 1 });
    expect(tx.sapling).toBeNull();
  });
});

/**
 * The block reward, against a real ZIP-213 shielded coinbase.
 *
 * Mainnet block 3,437,300's coinbase pays 12,500,000 zat to an address and 125,513,060 zat
 * into Ironwood, so every shielded pool must be a term of the reward.
 *
 * The second assertion matters most: the terms are added in domain sign (`poolFlowZat` has
 * already negated the RPC balance). Subtracting them from the raw RPC balance would produce
 * −113,013,060, and a test that only checked "not 12,500,000" would pass that.
 */
describe("blockRewardZatOf — every pool is a term, in DOMAIN sign", () => {
  it("adds the ironwood term on a shielded coinbase, matching the node exactly", () => {
    const { block } = parseBlock(shieldedCoinbase as never);
    // 12,500,000 transparent + 125,513,060 into Ironwood. Independently equal to
    // getblocksubsidy(3437300) (1.25 miner + 0.125 streams) plus the block's 513,060 zat of fees.
    expect(block.blockRewardZat).toBe(138_013_060);
  });

  it("is POSITIVE — the terms are added, not subtracted", () => {
    const { block } = parseBlock(shieldedCoinbase as never);
    expect(block.blockRewardZat).toBeGreaterThan(0);
    // The exact value the sign error produced, named so a regression cannot pass quietly.
    expect(block.blockRewardZat).not.toBe(-113_013_060);
  });
});
