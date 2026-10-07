import { base58checkEncode } from "./encoding/base58check";
import { bytesToHex } from "./encoding/hex";
import { ripemd160 } from "./encoding/ripemd160";
import { SECP256K1_N, secp256k1PublicKey } from "./encoding/secp256k1";
import { sha256 } from "./encoding/sha256";

/**
 * Bitcoin key derivation for `/satoshi`: random private key → uncompressed public key →
 * hash160 → P2PKH address, plus the WIF form a reader can paste into any offline tool to check
 * the derivation. A winning draw goes through the same code path; there is no payout branch.
 *
 * Not re-exported from `src/domain/index.ts`, so the BigInt curve arithmetic stays out of every
 * client bundle that imports the barrel.
 *
 * The target is Bitcoin's genesis coinbase output. It is P2PK, so the public key sits in the
 * script; `1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa` is that key hashed and base58check-encoded, the
 * address later tributes pay to. A test derives the address from the key rather than trusting
 * the typed string.
 */
export const GENESIS_TARGET = {
  publicKeyHex:
    "04678afdb0fe5548271967f1a67130b7105cd6a828e03909a67962e0ea1f61deb6" +
    "49f6bc3f4cef38c4f35504e51ec112de5c384df7ba0b8d578a4c702b6bf11d5f",
  hash160Hex: "62e907b15cbf27d5425399ebf6f0fb50ebb88f18",
  address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
} as const;

export interface DrawAttempt {
  /** 32 bytes, big-endian, lower-case hex. */
  readonly privateKeyHex: string;
  /** Wallet Import Format for an UNCOMPRESSED key: base58check(0x80 || key), 51 chars, `5…`. */
  readonly wif: string;
  /** `04 || x || y`, 130 hex chars. */
  readonly publicKeyHex: string;
  /** RIPEMD160(SHA256(publicKey)), 40 hex chars. */
  readonly hash160Hex: string;
  /** base58check(0x00 || hash160): 34 characters ~96% of the time, 33 otherwise. */
  readonly address: string;
  /** True when, and only when, `address` is the genesis target. */
  readonly jackpot: boolean;
}

export function hash160(data: Uint8Array): Uint8Array {
  return ripemd160(sha256(data));
}

export function p2pkhAddress(hash: Uint8Array): string {
  return base58checkEncode(Uint8Array.from([0x00, ...hash]));
}

export function wifEncode(privateKey: Uint8Array): string {
  return base58checkEncode(Uint8Array.from([0x80, ...privateKey]));
}

export function isJackpot(address: string): boolean {
  return address === GENESIS_TARGET.address;
}

export function deriveAttempt(privateKey: Uint8Array): DrawAttempt {
  const publicKey = secp256k1PublicKey(privateKey);
  if (publicKey === null) throw new Error("deriveAttempt: scalar outside [1, n-1]");
  const hash = hash160(publicKey);
  const address = p2pkhAddress(hash);
  return {
    privateKeyHex: bytesToHex(privateKey),
    wif: wifEncode(privateKey),
    publicKeyHex: bytesToHex(publicKey),
    hash160Hex: bytesToHex(hash),
    address,
    jackpot: isJackpot(address),
  };
}

/**
 * 32 random bytes inside [1, n-1], from the platform CSPRNG by default. The RNG is a parameter
 * so a test can drive the rejection loop (rejection probability is ~2^-128 per draw).
 */
export function randomPrivateKey(
  fill: (buffer: Uint8Array) => Uint8Array = (buffer) => crypto.getRandomValues(buffer),
): Uint8Array {
  for (;;) {
    const key = fill(new Uint8Array(32));
    let k = 0n;
    for (const byte of key) k = (k << 8n) | BigInt(byte);
    if (k !== 0n && k < SECP256K1_N) return key;
  }
}

/**
 * Per-position agreement between a derived address and the target, over the target's length.
 * Position 0 always agrees (the version byte). A shorter address misses its final positions.
 */
export function matchPositions(address: string, target: string): boolean[] {
  return Array.from(target, (ch, i) => address[i] === ch);
}
