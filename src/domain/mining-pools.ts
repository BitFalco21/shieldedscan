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
  | "zec-mining-pool";

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
};

/** The mining pool whose payout address this is, or null. Never a guess. */
export function miningPoolOf(address: string): MiningPool | null {
  const label = MINING_POOL_LABELS[address];
  return label ? MINING_POOLS[label.miningPool] : null;
}
