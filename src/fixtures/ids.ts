/** Deterministic fake 64-char hex id from a hex-only seed (0-9 a-f). */
export function hex64(seed: string): string {
  if (!/^[0-9a-f]+$/.test(seed)) throw new Error(`hex64 seed must be hex: ${seed}`);
  return seed.padEnd(64, "0");
}

/**
 * A fake serialised transaction for the detail page's raw view: the v5 header group a
 * real NU5 transaction starts with, then the txid cycled to a plausible length. Sample
 * data like everything else here — long enough to prove the collapsed view and the copy
 * affordance, deterministic so tests can assert against it.
 */
export function fakeRawHex(txid: string): string {
  return `050000800a27a726${txid.repeat(6)}`;
}

export const TIP_HEIGHT = 2_481_032;
export const TIP_TIME = 1_783_875_480; // 2026-07-12 ~17:38 UTC

/**
 * Coinbase payees. Three pools take turns mining the fixture chain, and each block also
 * pays the three Canopy funding streams — the era `TIP_HEIGHT` sits in. Streams are `t3`
 * (P2SH) because that is what they are on mainnet.
 */
export const ADDR_MINER = "t1MinerPoolPayoutFixture000001";
export const ADDR_MINER_B = "t1SecondPoolPayoutFixture00002";
export const ADDR_MINER_C = "t1SoloMinerPayoutFixture000003";
export const ADDR_FS_FOUNDATION = "t3FoundationStreamFixture00001";
export const ADDR_FS_BOOTSTRAP = "t3BootstrapStreamFixture000001";
export const ADDR_FS_GRANTS = "t3MajorGrantsStreamFixture0001";

export const ADDR_ALICE = "t1XWk29dAliceFixtureAddr000001";
export const ADDR_BOB = "t1Rq77maBobFixtureAddress00001";
export const ADDR_SAPLING = "zs1exampleshieldedsaplingaddressfixture0000000000000001";
export const ADDR_VAULT = "t1ThorVaultBoundaryFixture0001";

/**
 * A unified delivery address, for the one cross-chain crossing that lands on the shielded
 * side. `pulseZcashEnd` sends a unified or Sapling delivery to the boundary hub rather than
 * into the transparent box, and this fixture exercises that branch.
 *
 * Deliberately not decodable: `decodeUnifiedAddress` refuses it and the receiver panel is
 * absent, which is harmless here, where the address is a destination rather than a page's
 * subject.
 */
export const ADDR_UNIFIED = "u1fixtureunifiedboundaryaddress000000000000";

/**
 * Two real mainnet addresses. `ADDR_EXCHANGE` has a name in `ADDRESS_LABELS` and
 * `ADDR_UNNAMED` does not, so one fixture transaction renders both halves of `AddressLink`.
 *
 * Both are rich-list rows (#2 and #3), so `getAddress` resolves them through
 * `richListAddresses()`. Neither is in `addresses.ts`, so no hand-maintained balance can go
 * out of date.
 */
export const ADDR_EXCHANGE = "t1gsBrGZGMyDGZw2icGnMpVBuEGVWip5kH8";
export const ADDR_UNNAMED = "t1cpC3SS8okUsMQwTqWgzyA1k237B3WCeco";
