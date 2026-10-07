import type { Block, Transaction, TransparentOutput } from "@/domain";
import { blockComposition, blockMiner, totalFeeZat } from "@/domain";
import { TIP_HEIGHT, TIP_TIME, hex64 } from "./ids";
import { transactions } from "./transactions";

const BLOCK_INTERVAL = 75;
/**
 * 40 blocks — enough to span more than one page at the real page size (25), so
 * cursor pagination has a genuine "older" page to prove out in the e2e suite.
 */
const BLOCK_COUNT = 40;
const HEIGHTS = Array.from({ length: BLOCK_COUNT }, (_, i) => TIP_HEIGHT - (BLOCK_COUNT - 1) + i);

/**
 * What the fixture miners wrote into their coinbases, rotating with the pool that mined
 * the block. One block in the set has no tag at all, because most real coinbases carry no
 * message and a page that has never rendered the empty case has not been designed.
 */
const COINBASE_TAGS: (string | null)[] = [
  "🦓 fixture pool · privacy matters",
  "mined by a fixture",
  null,
];

/** Everything the coinbase paid out — subsidy plus anything it shielded. */
function rewardZat(coinbase: Transaction | undefined): number | null {
  if (coinbase === undefined) return null;
  const transparent = coinbase.transparentOutputs.reduce((sum, o) => sum + o.valueZat, 0);
  return (
    transparent +
    (coinbase.sapling?.valueBalanceZat ?? 0) +
    (coinbase.orchard?.valueBalanceZat ?? 0)
  );
}

/** Coinbase outputs that went somewhere other than the miner: the Canopy funding streams. */
function streamsOf(coinbase: Transaction | undefined, minerAddress: string | null) {
  if (coinbase === undefined) return [];
  return coinbase.transparentOutputs.filter((o: TransparentOutput) => o.address !== minerAddress);
}

export const blocks: Block[] = HEIGHTS.map((height) => {
  const txs = transactions.filter((t) => t.blockHeight === height);
  // coinbase first, then by txid for stable order
  txs.sort((a, b) => Number(b.isCoinbase) - Number(a.isCoinbase) || a.txid.localeCompare(b.txid));

  // Derived exactly as the node path derives them, from the same domain functions, so a
  // change to the rules cannot leave the fixture chain disagreeing with the real one.
  const coinbase = txs.find((t) => t.isCoinbase);
  const miner = blockMiner(txs);

  return {
    height,
    hash: hex64(`b${height}`),
    prevHash: hex64(`b${height - 1}`),
    timestamp: TIP_TIME - (TIP_HEIGHT - height) * BLOCK_INTERVAL,
    sizeBytes: 1500 + txs.reduce((s, t) => s + t.sizeBytes, 0),
    txids: txs.map((t) => t.txid),
    composition: blockComposition(txs),

    version: 4,
    difficulty: 146_914_688.75,
    bits: "1c00e9e0",
    nonce: hex64(`4e${height.toString(16)}`),
    merkleRoot: hex64(`4d${height.toString(16)}`),
    finalSaplingRoot: hex64(`5a${height.toString(16)}`),
    finalOrchardRoot: hex64(`04${height.toString(16)}`),

    miner,
    coinbaseTag: COINBASE_TAGS[height % COINBASE_TAGS.length] ?? null,
    fundingStreams: streamsOf(coinbase, miner.kind === "transparent" ? miner.address : null),
    blockRewardZat: rewardZat(coinbase),
    // The fixture source answers detail and list from the same array, so unlike the node
    // path this is always known — every fixture fee is.
    totalFeeZat: totalFeeZat(txs),
  };
});
