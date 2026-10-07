import { describe, expect, it } from "vitest";
import { bytesToHex, hexToBytes } from "../encoding/hex";
import {
  GENESIS_TARGET,
  deriveAttempt,
  hash160,
  isJackpot,
  matchPositions,
  p2pkhAddress,
  randomPrivateKey,
  wifEncode,
} from "../bitcoin-keys";
import { SECP256K1_N } from "../encoding/secp256k1";

const scalar = (n: bigint) => {
  const out = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return out;
};

const ADDRESS_SHAPE = /^1[1-9A-HJ-NP-Za-km-z]{25,33}$/;
const WIF_SHAPE = /^5[1-9A-HJ-NP-Za-km-z]{50}$/;

describe("the genesis target", () => {
  it("is derived from consensus data, not merely typed", () => {
    // The genesis coinbase output is P2PK: the public key is in the script itself. The
    // target address is that key hashed, so this pins the typed string to the chain rather
    // than to another explorer's transcription of it.
    const pub = hexToBytes(GENESIS_TARGET.publicKeyHex);
    expect(pub.length).toBe(65);
    expect(bytesToHex(hash160(pub))).toBe(GENESIS_TARGET.hash160Hex);
    expect(p2pkhAddress(hash160(pub))).toBe(GENESIS_TARGET.address);
    expect(GENESIS_TARGET.address).toBe("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa");
    expect(GENESIS_TARGET.address.length).toBe(34);
  });
});

describe("deriveAttempt", () => {
  it("derives the k=1 address every Bitcoin textbook prints", () => {
    const attempt = deriveAttempt(scalar(1n));
    expect(attempt.address).toBe("1EHNa6Q4Jz2uvNExL497mE43ikXhwF6kZm");
    expect(attempt.privateKeyHex).toBe("0".repeat(63) + "1");
    expect(attempt.publicKeyHex.startsWith("0479be667e")).toBe(true);
    expect(attempt.jackpot).toBe(false);
  });

  it("matches the Bitcoin wiki's worked example, address and WIF", () => {
    const key = hexToBytes("18E14A7B6A307F426A94F8114701E7C8E774E7F9A47E2C2035DB29A206321725");
    const attempt = deriveAttempt(key);
    expect(attempt.publicKeyHex).toBe(
      "0450863ad64a87ae8a2fe83c1af1a8403cb53f53e486d8511dad8a04887e5b2352" +
        "2cd470243453a299fa9e77237716103abc11a1df38855ed6f2ee187e9c582ba6",
    );
    expect(attempt.hash160Hex).toBe("010966776006953d5567439e5e39f86a0d273bee");
    expect(attempt.address).toBe("16UwLL9Risc3QfPqBUvKofHmBQ7wMtjvM");
    expect(attempt.wif).toBe("5J1F7GHadZG3sCCKHCwg8Jvys9xUbFsjLnGec4H125Ny1V9nR6V");
    expect(wifEncode(key)).toBe(attempt.wif);
  });

  it("throws on a scalar outside [1, n-1] rather than deriving nonsense", () => {
    expect(() => deriveAttempt(scalar(0n))).toThrow();
    expect(() => deriveAttempt(scalar(SECP256K1_N))).toThrow();
  });

  it("reports the jackpot when, and only when, the address is the target", () => {
    // Nobody holds a key for the target, so the win predicate is tested on its own: it is the
    // one function deriveAttempt consults, and the page consults nothing else.
    expect(isJackpot(deriveAttempt(scalar(1n)).address)).toBe(false);
    expect(isJackpot(GENESIS_TARGET.address)).toBe(true);
    expect(isJackpot(GENESIS_TARGET.address.slice(0, 33))).toBe(false);
  });
});

describe("randomPrivateKey", () => {
  it("resamples until the scalar is inside [1, n-1]", () => {
    const draws = [scalar(0n), scalar(SECP256K1_N), scalar(7n)];
    let i = 0;
    const key = randomPrivateKey((buf) => {
      buf.set(draws[i++]!);
      return buf;
    });
    expect(key).toEqual(scalar(7n));
    expect(i).toBe(3);
  });

  it("uses the platform RNG by default and yields 32 bytes", () => {
    const a = randomPrivateKey();
    const b = randomPrivateKey();
    expect(a.length).toBe(32);
    expect(bytesToHex(a)).not.toBe(bytesToHex(b));
  });
});

describe("200 real draws", () => {
  it("every attempt re-derives to itself, is well-formed, and none is the jackpot", () => {
    let short = 0;
    for (let i = 0; i < 200; i++) {
      const key = randomPrivateKey();
      const attempt = deriveAttempt(key);
      const again = deriveAttempt(hexToBytes(attempt.privateKeyHex));
      expect(again).toEqual(attempt);
      expect(attempt.address).toMatch(ADDRESS_SHAPE);
      expect(attempt.wif).toMatch(WIF_SHAPE);
      expect(attempt.publicKeyHex).toMatch(/^04[0-9a-f]{128}$/);
      expect(attempt.hash160Hex).toMatch(/^[0-9a-f]{40}$/);
      expect(attempt.jackpot).toBe(false);
      if (attempt.address.length < 34) short += 1;
    }
    // ~4% of P2PKH addresses are 33 characters; a run of 200 with none would be odd but not
    // impossible, so this only records that the shorter form is reachable by the shape regex.
    expect(short).toBeLessThan(40);
  });
});

describe("matchPositions", () => {
  it("compares character by character against the target, padded to its length", () => {
    const hits = matchPositions("1EHNa6Q4Jz2uvNExL497mE43ikXhwF6kZm", GENESIS_TARGET.address);
    expect(hits.length).toBe(34);
    expect(hits[0]).toBe(true); // the version byte: every P2PKH address starts with 1
    expect(hits.filter(Boolean).length).toBeGreaterThanOrEqual(1);
  });

  it("marks a 33-character address as missing its last position, never as matching it", () => {
    const short = "1" + "2".repeat(32);
    const hits = matchPositions(short, GENESIS_TARGET.address);
    expect(hits.length).toBe(34);
    expect(hits[33]).toBe(false);
  });

  it("is all true only for the target itself", () => {
    expect(matchPositions(GENESIS_TARGET.address, GENESIS_TARGET.address).every(Boolean)).toBe(
      true,
    );
  });
});

describe("hex helpers", () => {
  it("round-trip and lower-case", () => {
    expect(bytesToHex(hexToBytes("00FFa1"))).toBe("00ffa1");
    expect(() => hexToBytes("abc")).toThrow();
  });
});
