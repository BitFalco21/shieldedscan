import { describe, expect, it } from "vitest";
import { base58checkDecode, base58checkEncode } from "../encoding/base58check";
import { bech32Decode, bech32Encode, convertBits } from "../encoding/bech32";
import { blake2b } from "../encoding/blake2b";
import { ripemd160 } from "../encoding/ripemd160";
import {
  SECP256K1_G,
  SECP256K1_N,
  SECP256K1_P,
  isOnCurve,
  secp256k1PublicKey,
} from "../encoding/secp256k1";
import { sha256 } from "../encoding/sha256";

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const ascii = (text: string) => Uint8Array.from(text, (ch) => ch.charCodeAt(0));

describe("blake2b", () => {
  it("matches the RFC 7693 appendix vector for BLAKE2b-512('abc')", () => {
    expect(hex(blake2b(ascii("abc"), 64))).toBe(
      "ba80a53f981c4d0d6a2797b69f12f6e94c212f14685ac4b74b12bb6fdbffa2d1" +
        "7d87c5392aab792dc252d5de4533cc9518d38aa8dbf1925ab92386edd4009923",
    );
  });

  it("hashes the empty message and multi-block messages", () => {
    // Independently checked against Python hashlib.blake2b.
    expect(hex(blake2b(new Uint8Array(0), 64))).toBe(
      "786a02f742015903c6c6fd852552d272912f4740e15847618a86e217f71f5419" +
        "d25e1031afee585313896444934eb04b903a685b1448b755d56f701afe9be2ce",
    );
    const long = new Uint8Array(300); // spans three compression blocks
    for (let i = 0; i < long.length; i++) long[i] = i & 0xff;
    expect(hex(blake2b(long, 64)).length).toBe(128);
    // Digest length is part of the parameter block, not a truncation: a 32-byte
    // digest must differ from the first 32 bytes of the 64-byte one.
    expect(hex(blake2b(ascii("abc"), 32))).not.toBe(hex(blake2b(ascii("abc"), 64)).slice(0, 64));
  });

  it("personalization changes the digest", () => {
    const plain = blake2b(ascii("abc"), 64);
    const personalized = blake2b(ascii("abc"), 64, ascii("UA_F4Jumble_H"));
    expect(hex(personalized)).not.toBe(hex(plain));
  });
});

describe("sha256", () => {
  it("matches the FIPS 180-4 vectors", () => {
    expect(hex(sha256(ascii("abc")))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(hex(sha256(new Uint8Array(0)))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});

describe("bech32 / bech32m", () => {
  it("decodes the BIP-350 valid bech32m strings", () => {
    for (const valid of ["abcdef1l7aum6echk45nj3s0wdvt2fg8x9yrzpqzd3ryx", "a1lqfn3a", "?1v759aa"]) {
      const decoded = bech32Decode(valid);
      expect(decoded?.variant).toBe("bech32m");
    }
  });

  it("decodes the BIP-173 valid bech32 strings", () => {
    for (const valid of [
      "a12uel5l",
      "abcdef1qpzry9x8gf2tvdw0s3jn54khce6mua7lmqqqxw",
      "split1checkupstagehandshakeupstreamerranterredcaperred2y9e3w",
    ]) {
      const decoded = bech32Decode(valid);
      expect(decoded?.variant).toBe("bech32");
    }
  });

  it("rejects mixed case, bad charset and corrupted checksums", () => {
    expect(bech32Decode("A1LQfn3a")).toBeNull(); // mixed case
    expect(bech32Decode("a1lqfn3b")).toBeNull(); // checksum flipped
    expect(bech32Decode("abc1rzgbe")).toBeNull(); // 'b' not in charset would land here
    expect(bech32Decode("1qzzfhee")).toBeNull(); // empty HRP
  });

  it("round-trips arbitrary data far past BIP-350's 90-char cap (ZIP 316 needs this)", () => {
    const bytes = new Uint8Array(150);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 37) & 0xff;
    const groups = convertBits(bytes, 8, 5, true);
    expect(groups).not.toBeNull();
    const encoded = bech32Encode("u", groups!, "bech32m");
    expect(encoded.length).toBeGreaterThan(90);
    const decoded = bech32Decode(encoded);
    expect(decoded?.hrp).toBe("u");
    expect(decoded?.variant).toBe("bech32m");
    const back = convertBits(decoded!.data, 5, 8, false);
    expect(hex(Uint8Array.from(back!))).toBe(hex(bytes));
  });

  it("convertBits without padding rejects non-zero leftover bits", () => {
    expect(convertBits([31], 5, 8, false)).toBeNull();
  });
});

describe("base58check", () => {
  it("encodes a known Zcash transparent prefix to a t1 address shape", () => {
    // 0x1CB8 + 20 bytes is the mainnet P2PKH form; the exact string is pinned by
    // the unified-address vectors — here just the shape and determinism.
    const payload = Uint8Array.from([0x1c, 0xb8, ...new Array(20).fill(7)]);
    const encoded = base58checkEncode(payload);
    expect(encoded).toMatch(/^t1[1-9A-HJ-NP-Za-km-z]{20,40}$/);
    expect(base58checkEncode(payload)).toBe(encoded);
  });

  it("preserves leading zero bytes as literal 1s", () => {
    expect(base58checkEncode(Uint8Array.from([0, 0, 1]))).toMatch(/^11/);
  });
});

describe("ripemd160", () => {
  // The ISO/IEC 10118-3 vector set, each re-checked against Node's OpenSSL before commit.
  const VECTORS: ReadonlyArray<readonly [string, string]> = [
    ["", "9c1185a5c5e9fc54612808977ee8f548b2258d31"],
    ["a", "0bdc9d2d256b3ee9daae347be6f4dc835a467ffe"],
    ["abc", "8eb208f7e05d987a9b044a8e98c6b087f15a0bfc"],
    ["message digest", "5d0689ef49d2fae572b881b123a85ffa21595f36"],
    ["abcdefghijklmnopqrstuvwxyz", "f71c27109c692c1b56bbdceb5b9d2865b3708dbc"],
    [
      "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
      "12a053384a9c0c88e405a06c27dcf49ada62eb2b",
    ],
    [
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
      "b0e20b6e3116640286ed3a87a5713079b21f5189",
    ],
    ["1234567890".repeat(8), "9b752e45573d4b39f4dbd3323cab82bf63326bfb"],
  ];

  it("matches the ISO/IEC 10118-3 vectors", () => {
    for (const [message, digest] of VECTORS) {
      expect(hex(ripemd160(ascii(message))), JSON.stringify(message.slice(0, 20))).toBe(digest);
    }
  });

  it("hashes a million 'a' — many blocks, length past 2^20 bits", () => {
    const million = new Uint8Array(1_000_000).fill(0x61);
    expect(hex(ripemd160(million))).toBe("52783243c1697bdbe16d37f97f68f08325dc1528");
  });

  it("does not mutate its input", () => {
    const input = ascii("abc");
    ripemd160(input);
    expect(Array.from(input)).toEqual([0x61, 0x62, 0x63]);
  });
});

describe("secp256k1", () => {
  const scalar = (n: bigint) => {
    const out = new Uint8Array(32);
    for (let i = 31; i >= 0; i--) {
      out[i] = Number(n & 0xffn);
      n >>= 8n;
    }
    return out;
  };
  const GX = "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
  const GY = "483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8";

  it("pins the curve constants", () => {
    expect(SECP256K1_P).toBe(2n ** 256n - 2n ** 32n - 977n);
    expect(SECP256K1_N.toString(16)).toBe(
      "fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141",
    );
    expect(SECP256K1_G.x.toString(16)).toBe(GX);
    expect(SECP256K1_G.y.toString(16)).toBe(GY);
    expect(isOnCurve(SECP256K1_G.x, SECP256K1_G.y)).toBe(true);
    expect(isOnCurve(SECP256K1_G.x, SECP256K1_G.y + 1n)).toBe(false);
  });

  it("derives G, 2G and 3G (checked against OpenSSL's ECDH)", () => {
    expect(hex(secp256k1PublicKey(scalar(1n))!)).toBe(`04${GX}${GY}`);
    expect(hex(secp256k1PublicKey(scalar(2n))!)).toBe(
      "04c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5" +
        "1ae168fea63dc339a3c58419466ceaeef7f632653266d0e1236431a950cfe52a",
    );
    expect(hex(secp256k1PublicKey(scalar(3n))!)).toBe(
      "04f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9" +
        "388f7b0f632de8140fe337e62a37f3566500a99934c2231b6cb9fd7584b8e672",
    );
  });

  it("derives (n-1)G as the reflection of G", () => {
    const pub = secp256k1PublicKey(scalar(SECP256K1_N - 1n))!;
    expect(hex(pub.subarray(1, 33))).toBe(GX);
    expect(BigInt(`0x${hex(pub.subarray(33))}`)).toBe(SECP256K1_P - SECP256K1_G.y);
  });

  it("matches the Bitcoin wiki's worked example", () => {
    const key = scalar(0x18e14a7b6a307f426a94f8114701e7c8e774e7f9a47e2c2035db29a206321725n);
    expect(hex(secp256k1PublicKey(key)!)).toBe(
      "0450863ad64a87ae8a2fe83c1af1a8403cb53f53e486d8511dad8a04887e5b2352" +
        "2cd470243453a299fa9e77237716103abc11a1df38855ed6f2ee187e9c582ba6",
    );
  });

  it("refuses an out-of-range or malformed scalar", () => {
    expect(secp256k1PublicKey(scalar(0n))).toBeNull();
    expect(secp256k1PublicKey(scalar(SECP256K1_N))).toBeNull();
    expect(secp256k1PublicKey(scalar(SECP256K1_N + 1n))).toBeNull();
    expect(secp256k1PublicKey(new Uint8Array(31))).toBeNull();
    expect(secp256k1PublicKey(new Uint8Array(33))).toBeNull();
  });

  it("puts every random public key on the curve, deterministically", () => {
    for (let i = 0; i < 20; i++) {
      const key = new Uint8Array(32);
      for (let j = 0; j < 32; j++) key[j] = Math.floor(Math.random() * 256);
      const a = secp256k1PublicKey(key)!;
      const b = secp256k1PublicKey(key)!;
      expect(a[0]).toBe(0x04);
      expect(hex(a)).toBe(hex(b));
      expect(
        isOnCurve(BigInt(`0x${hex(a.subarray(1, 33))}`), BigInt(`0x${hex(a.subarray(33))}`)),
      ).toBe(true);
    }
  });
});

describe("base58checkDecode", () => {
  it("round-trips the encoder, leading zeros included", () => {
    for (const payload of [
      Uint8Array.from([0x1c, 0xb8, ...new Array(20).fill(7)]),
      Uint8Array.from([0, 0, 1]),
    ]) {
      expect(Array.from(base58checkDecode(base58checkEncode(payload)) ?? [])).toEqual(
        Array.from(payload),
      );
    }
  });

  it("accepts a real mainnet transparent address", () => {
    const payload = base58checkDecode("t1VPyM1j4kRbQRzD6fudpv6fzMJzeRoF83x");
    expect(payload?.length).toBe(22);
    expect(Array.from(payload!.subarray(0, 2))).toEqual([0x1c, 0xb8]);
  });

  it("rejects one changed character, and a character outside the alphabet", () => {
    expect(base58checkDecode("t1VPyM1j4kRbQRzD6fudpv6fzMJzeRoF83y")).toBeNull();
    expect(base58checkDecode("t1VPyM1j4kRbQRzD6fudpv6fzMJzeRoF830")).toBeNull();
    expect(base58checkDecode("")).toBeNull();
  });
});
