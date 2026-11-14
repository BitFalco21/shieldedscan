/**
 * Mining pools named by their payout addresses.
 *
 * A pool's name is a claim about a real company, so it attaches to an address only after a
 * person has reviewed the evidence for that address, and never to a block's coinbase tag: a tag
 * is miner-written text that anyone can copy.
 *
 * Kept apart from `ADDRESS_LABELS` on purpose. A pool name is shown only where an address is a
 * block's payout (the miner column, the block page) and on that address's own page, never in a
 * customer's history beside the payment it received. `AddressLink` decides where it applies.
 *
 * Named `mining pool` throughout: `pool` alone means a shielded value pool here (`pool.ts`).
 */

export type MiningPoolId =
  | "viabtc"
  | "foundry"
  | "f2pool"
  | "luxor"
  | "2miners"
  | "antpool"
  | "kupool"
  | "kryptex"
  | "nicehash"
  | "mining-dutch"
  | "zec-mining-pool"
  | "poolin"
  | "flypool"
  | "coinotron";

export interface MiningPool {
  id: MiningPoolId;
  /** The name as the pool writes it. */
  name: string;
  /**
   * The id of a committed icon under `public/ecosystem/logos/`, or null to draw the neutral
   * label glyph. Shared with `/ecosystem`, whose test requires every icon to belong to one of
   * its entries, so a pool without an ecosystem entry has no logo.
   */
  logo: string | null;
}

export const MINING_POOLS: { readonly [K in MiningPoolId]: MiningPool & { id: K } } = {
  viabtc: { id: "viabtc", name: "ViaBTC", logo: "viabtc" },
  foundry: { id: "foundry", name: "Foundry USA", logo: "foundry" },
  f2pool: { id: "f2pool", name: "F2Pool", logo: "f2pool" },
  luxor: { id: "luxor", name: "Luxor", logo: "luxor" },
  "2miners": { id: "2miners", name: "2Miners", logo: "2miners" },
  antpool: { id: "antpool", name: "AntPool", logo: "antpool" },
  kupool: { id: "kupool", name: "KuPool", logo: "kupool" },
  kryptex: { id: "kryptex", name: "Kryptex", logo: "kryptex" },
  nicehash: { id: "nicehash", name: "NiceHash", logo: "nicehash" },
  "mining-dutch": { id: "mining-dutch", name: "Mining-Dutch", logo: "mining-dutch" },
  "zec-mining-pool": { id: "zec-mining-pool", name: "ZEC Mining Pool", logo: null },
  // Pools that mined Zcash in earlier years and no longer do.
  poolin: { id: "poolin", name: "Poolin", logo: null },
  flypool: { id: "flypool", name: "Flypool", logo: null },
  coinotron: { id: "coinotron", name: "Coinotron", logo: null },
};

/**
 * How we know an address is the pool's. Recorded, never rendered.
 *
 * - `pool-published` — the pool's own data claims it: its block list, checked against the chain
 *   by height and hash in both directions, or its own dashboard naming the address.
 * - `coinbase-tag` — the pool's complete marker on the address's blocks, consistent across the
 *   samples taken. Self-declared and spoofable, so it never travels as `pool-published`.
 */
export type MiningPoolBasis = "pool-published" | "coinbase-tag";

export interface MiningPoolLabel {
  miningPool: MiningPoolId;
  basis: MiningPoolBasis;
  /** What was checked, and when. Recorded here, rendered nowhere. */
  evidence: string;
}

const VIABTC_LIST =
  "ViaBTC's own block list; every listed block pays this address and every chain block paying it in the checked ranges is listed (2026-11-06)";

/**
 * The reviewed payout addresses.
 *
 * Only addresses that have mined at least 100 blocks. Held back, and never to be added without new
 * evidence: addresses whose name was contradicted or rests on a marker that stopped appearing,
 * fee and customer addresses of a pool (a customer's address is never stored), small solo pools,
 * and addresses that are not miners. One address is one address: listing a pool's several
 * addresses here names each of them, it does not cluster them.
 */
export const MINING_POOL_LABELS: Readonly<Record<string, MiningPoolLabel>> = {
  t1MKn34KBa8Xh4g8qU8psibBXvURafphVn7: {
    miningPool: "viabtc",
    basis: "pool-published",
    evidence: VIABTC_LIST,
  },
  // Third parties call it "ViaBTC-Solo"; ViaBTC lists its blocks as pool blocks, not solo.
  t1SEgZvXCu3ceE42qrq5pCeSq7HbLjX8NJv: {
    miningPool: "viabtc",
    basis: "pool-published",
    evidence: VIABTC_LIST,
  },
  // This and the next two were retired at the mid-2026 handover to the two addresses above.
  t1at7nVNsv6taLRrNRvnQdtfLNRDfsGc3Ak: {
    miningPool: "viabtc",
    basis: "pool-published",
    evidence: VIABTC_LIST,
  },
  t1ZVi2YGk98tEGYcNpXYnJFWCoLG2oYwv3J: {
    miningPool: "viabtc",
    basis: "pool-published",
    evidence: VIABTC_LIST,
  },
  t1K79TgQbqu74d6rBmsMu2oFEXEwAmdYiT7: {
    miningPool: "viabtc",
    basis: "pool-published",
    evidence: VIABTC_LIST,
  },
  t1SqwRAAdSig6dE4EBPLonAait219VmkUjP: {
    miningPool: "foundry",
    basis: "coinbase-tag",
    evidence: "`Foundry Zcash Pool` on 494 of 494 sampled blocks (2026-11-06)",
  },
  t1PEp2GJLSdhDfCKqc2J211WKDUS1NfoQNy: {
    miningPool: "f2pool",
    basis: "coinbase-tag",
    evidence:
      "`七彩神仙鱼`, F2Pool's marker, on 313 of 313 sampled blocks 2025-01 to 2026-06; F2Pool publishes no ZEC block list (2026-11-06)",
  },
  t1TVdjqU1APVQmCRRnzbqfjz6wR2qtBnnoc: {
    miningPool: "luxor",
    basis: "coinbase-tag",
    evidence: "`/Mined by Luxor/` on 467 of 467 sampled blocks (2026-11-06)",
  },
  // Luxor's payout between its previous address (to 3,522,962) and its current one (from 3,524,453).
  t1Zdu26WGAzCJR1waaTUNMRx57nHbwdjTd2: {
    miningPool: "luxor",
    basis: "coinbase-tag",
    evidence: "`/Mined by Luxor/` on 181 of 181 blocks, heights 3,523,047–3,524,433 (2026-11-14)",
  },
  // Luxor's previous address, retired at 3,522,962.
  t1XQZdZMnzXBcL8yx2PR27dSNrqctgwLgux: {
    miningPool: "luxor",
    basis: "coinbase-tag",
    evidence: "`/Mined by Luxor/` on its newest blocks (2026-11-06)",
  },
  t1VTjv7XF3hYqxQkxKmHHErvus3bDrbbkGg: {
    miningPool: "2miners",
    basis: "pool-published",
    evidence: "2Miners' own block list, heights and hashes matched (2026-11-06)",
  },
  t1QxTHUputbmZRxd3EqP671sLqd6KNBQbXJ: {
    miningPool: "2miners",
    basis: "pool-published",
    evidence: "2Miners' own solo-pool block list, heights and hashes matched (2026-11-06)",
  },
  // 2Miners' earlier addresses: t1bnxtY7… funded t1fu6… on-chain, which handed over to t1VTjv7X….
  t1fu6KgYtHEXk2ZhTpM1XD7jbnSmW6wokDM: {
    miningPool: "2miners",
    basis: "coinbase-tag",
    evidence: "2Miners' marker with its own domain on every sampled block, 2026-06 (2026-11-06)",
  },
  t1bnxtY7aLCjWx9Ru1YcGwRWch3eEWUFK7u: {
    miningPool: "2miners",
    basis: "coinbase-tag",
    evidence:
      "2Miners' marker with its own domain on every sampled block, 2025-01 to 2026-06 (2026-11-06)",
  },
  t1L2b66MXbgpVMXDfUa94GCBFAN4dCxGohM: {
    miningPool: "antpool",
    basis: "pool-published",
    evidence:
      "AntPool's own block list, 53 of 53 recent blocks matched in both directions (2026-11-06)",
  },
  t1Y2tYgDJnH4m1uQPDXxvXQSh1Jbun3AP22: {
    miningPool: "kupool",
    basis: "coinbase-tag",
    evidence: "`mined by KuPool` on 40 of 40 sampled blocks (2026-11-06)",
  },
  t1e6hceYHkzCbwcwGZzKeMfXXW7x7gr19Cw: {
    miningPool: "kryptex",
    basis: "pool-published",
    evidence: "Kryptex's own block list, heights and hashes matched (2026-11-06)",
  },
  t1eBv4a3wBhVaFgWYjXrFYTU7pruCWaBpLW: {
    miningPool: "nicehash",
    basis: "coinbase-tag",
    evidence: "`/NiceHash/` on 3 of 3 sampled blocks (2026-11-06)",
  },
  t1cQA9Rxn31tqHcgZzydrpDjgsQGmjpBgpB: {
    miningPool: "mining-dutch",
    basis: "pool-published",
    evidence:
      "Mining-Dutch's own block list, 31 of 31 recent blocks matched in both directions (2026-11-06)",
  },
  // Its blocks have gone to a shielded coinbase since 2026-09.
  t1Uo7EN1A3GN29UjQJbUFYvrhxQd6Gt7qdA: {
    miningPool: "zec-mining-pool",
    basis: "pool-published",
    evidence: "ZEC Mining Pool's own dashboard names this address as its pool (2026-11-06)",
  },

  // ---------------------------------------------------------------- earlier years
  //
  // Reviewed over each address's whole history in the chain index. Each coinbase-tag entry carries
  // its pool's marker on at least 95% of its blocks and no other pool's marker, and keeps it to
  // its last block: an address whose marker stopped while it kept mining is held back.

  // Its tag stopped at 1,679,513 and it mined 23,012 more blocks; ViaBTC's own list claims those.
  t1godRk4oKt689om4Q3CbmA9wsuhm1rUvLR: {
    miningPool: "viabtc",
    basis: "pool-published",
    evidence:
      "ViaBTC's own block list in nine windows, 223,971–1,741,699: it lists 784 of the 785 chain blocks paying this address, and no block the chain kept that pays anyone but ViaBTC; `/ViaBTC/` on 157,938 of 180,966 blocks, through 1,679,513 (2026-11-10)",
  },
  // The text after "Mined by" names F2Pool's customer, never another pool.
  t1aZvxRLCGVeMPFXvqfnBgHVEbi4c6g8MVa: {
    miningPool: "f2pool",
    basis: "coinbase-tag",
    evidence: "`七彩神仙鱼` on 132,904 of 132,904 blocks, heights 3,909–822,545 (2026-11-10)",
  },
  t1YN48pMwyG4aszU411jKdY7MHyPpJB8jPq: {
    miningPool: "f2pool",
    basis: "coinbase-tag",
    evidence: "`七彩神仙鱼` on 295,999 of 295,999 blocks, heights 812,265–2,407,531 (2026-11-10)",
  },
  t1ZYZS6ynUDbvht7vH3dMiM3rsAJ1p6EGWC: {
    miningPool: "antpool",
    basis: "coinbase-tag",
    evidence: "`Mined by AntPool` on 50,662 of 50,662 blocks, heights 4,435–673,228 (2026-11-10)",
  },
  t1a4eP8SuDGVizftxMcFh9DEDYi1XzKarfz: {
    miningPool: "antpool",
    basis: "coinbase-tag",
    evidence: "`Mined by AntPool` on 2,030 of 2,030 blocks, heights 598,094–1,231,806 (2026-11-10)",
  },
  t1Xvjk8XQZ6S87n83ZCHRdoFJ8GZ7sq4FZN: {
    miningPool: "antpool",
    basis: "coinbase-tag",
    evidence:
      "`Mined by AntPool` on 77,309 of 77,309 blocks, heights 670,067–1,222,534 (2026-11-10)",
  },
  t1bo889qq1f24fEwEC5efozKWfAvWe3tEww: {
    miningPool: "antpool",
    basis: "coinbase-tag",
    evidence:
      "`Mined by AntPool` on 21,452 of 21,452 blocks, heights 1,231,807–1,354,216 (2026-11-10)",
  },
  t1L2rjgGrvEqfrA5zqUca4GGxAeQg47CTpG: {
    miningPool: "luxor",
    basis: "coinbase-tag",
    evidence: "`\\LUXOR\\` on 38,822 of 38,822 blocks, heights 843,859–1,519,951 (2026-11-10)",
  },
  // Both 2Miners addresses wrote no tag on their first blocks, then the marker on every block.
  t1dzbQ2bnAGwBVHZykfKYTQYyZY1AjrS1Mg: {
    miningPool: "2miners",
    basis: "coinbase-tag",
    evidence:
      "`2Miners https://2miners.com` on 21,667 of 21,834 blocks, every one from 343,715 to its last at 2,149,887; the 167 before carry no tag (2026-11-10)",
  },
  t1ajyFP7GnauoDFaM8MqJx9ouQjKS3tbA7g: {
    miningPool: "2miners",
    basis: "coinbase-tag",
    evidence:
      "`2Miners https://2miners.com` on 7,008 of 7,248 blocks, every one from 344,640 to its last at 2,149,478; the 240 before carry no tag (2026-11-10)",
  },
  // 2Miners' addresses beside t1dzbQ2b… and t1ajyFP7…, from their handover at 2,149,9xx.
  t1NSiJnvv1A6uUfkLj4Zi6cLMqQ44SC8ja4: {
    miningPool: "2miners",
    basis: "coinbase-tag",
    evidence:
      "`2Miners https://2miners.com` on 11,416 of 11,416 blocks, heights 2,149,920–2,510,274 (2026-11-14)",
  },
  t1LRTUjrLE2RHsS75cjCrxB7xaLTwaVkwao: {
    miningPool: "2miners",
    basis: "coinbase-tag",
    evidence:
      "`2Miners https://2miners.com` on 3,475 of 3,475 blocks, heights 2,149,993–3,366,122 (2026-11-14)",
  },
  t1Pxv9u2jWySHJPFpKimYMAtEbdHEvuYdS2: {
    miningPool: "2miners",
    basis: "coinbase-tag",
    evidence:
      "`2Miners https://2miners.com` on 119 of 119 blocks, heights 3,366,503–3,414,154, after t1LRTUjr… and before t1VTjv7X… (2026-11-14)",
  },
  // Poolin's addresses whose every block carries its marker. Others of its addresses lost the
  // marker partway and stay unlabelled.
  t1QmwNr6jNRqGSojh1yHjzfL3EhCsG6LxC7: {
    miningPool: "poolin",
    basis: "coinbase-tag",
    evidence: "`/poolin.com/` on 9,392 of 9,392 blocks, heights 537,020–713,442 (2026-11-10)",
  },
  t1bJgWJgHgrs6K9L96T9tSK1EBs3iNSzfJq: {
    miningPool: "poolin",
    basis: "coinbase-tag",
    evidence: "`/poolin.com/` on 1,110 of 1,110 blocks, heights 713,526–736,577 (2026-11-10)",
  },
  t1dDC48of9TQH2ewNb7za7x5ZiCT2Fo4xC6: {
    miningPool: "poolin",
    basis: "coinbase-tag",
    evidence: "`/poolin.com/` on 714 of 714 blocks, heights 734,380–746,934 (2026-11-10)",
  },
  t1ZMXcX4ccb7DNoN2nPDEfhWqLtAGeQ2obE: {
    miningPool: "poolin",
    basis: "coinbase-tag",
    evidence: "`/poolin.com/` on 12,170 of 12,170 blocks, heights 746,955–904,156 (2026-11-10)",
  },
  t1bzsJ7mRyHwsuXEPMud32SFTjLJ7FrWfpf: {
    miningPool: "poolin",
    basis: "coinbase-tag",
    evidence: "`/poolin.com/` on 17,958 of 17,958 blocks, heights 871,064–981,651 (2026-11-10)",
  },
  t1fD2SKAFthHmZmGDfekQFW11M6m2kPYpe7: {
    miningPool: "poolin",
    basis: "coinbase-tag",
    evidence: "`/poolin.com/` on 8,295 of 8,295 blocks, heights 904,169–1,040,417 (2026-11-10)",
  },
  t1XepX38RxS3o5hLioLbaNb6Fa2Y2Be55xw: {
    miningPool: "flypool",
    basis: "coinbase-tag",
    evidence: "`/flypool/` on 2,116 of 2,116 blocks, heights 341–10,068 (2026-11-10)",
  },
  t1ZJQNuop1oytQ7ow4Kq8o9if3astavba5W: {
    miningPool: "flypool",
    basis: "coinbase-tag",
    evidence: "`/flypool/` on 52,896 of 52,896 blocks, heights 10,078–138,646 (2026-11-10)",
  },
  t1VpYecBW4UudbGcy4ufh61eWxQCoFaUrPs: {
    miningPool: "flypool",
    basis: "coinbase-tag",
    evidence: "`/flypool/` on 96,530 of 96,530 blocks, heights 138,555–314,492 (2026-11-10)",
  },
  t1Xk6GeseeV8FSDpgr359yL2LmaRtUdWgaq: {
    miningPool: "coinotron",
    basis: "coinbase-tag",
    evidence: "`Coinotron` on 4,124 of 4,124 blocks, heights 32,104–132,221 (2026-11-10)",
  },
  t1Tqy2u2qgTdcVf7TRxC2KGrxwcuzfdgnSf: {
    miningPool: "coinotron",
    basis: "coinbase-tag",
    evidence: "`Coinotron` on 8,263 of 8,263 blocks, heights 132,232–232,907 (2026-11-10)",
  },
  t1Z4fP81GQcwfpTYuRafeM1ACfyZUoNRKaB: {
    miningPool: "coinotron",
    basis: "coinbase-tag",
    evidence: "`Coinotron` on 2,923 of 2,923 blocks, heights 233,209–493,667 (2026-11-10)",
  },
  t1fypqjbxSoiq27rFfXuE6iTHkoBXXpY1J4: {
    miningPool: "coinotron",
    basis: "coinbase-tag",
    evidence: "`Coinotron` on 488 of 488 blocks, heights 496,196–1,049,441 (2026-11-10)",
  },
};

/** The mining pool whose payout address this is, or null. Never a guess. */
export function miningPoolOf(address: string): MiningPool | null {
  const label = MINING_POOL_LABELS[address];
  return label ? MINING_POOLS[label.miningPool] : null;
}
