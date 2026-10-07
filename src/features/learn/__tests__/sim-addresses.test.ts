import { describe, expect, it } from "vitest";
import { classifyZcashAddress, decodeUnifiedAddress } from "@/domain";
import { bech32Decode } from "@/domain/encoding/bech32";
import { sha256 } from "@/domain/encoding/sha256";
import { SIM_ADDRESSES } from "../sim-model";

/**
 * The simulator's test addresses must look real, so a beginner learns what a real address looks
 * like, and must never be usable: a reader who copies one into a real wallet must be refused,
 * not lose real ZEC. Each is a valid address with one character changed, so its checksum fails.
 * This proves it with independent checks, not by assertion.
 */

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Decode(s: string): Uint8Array | null {
  let n = 0n;
  for (const c of s) {
    const i = ALPHABET.indexOf(c);
    if (i < 0) return null;
    n = n * 58n + BigInt(i);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n % 256n));
    n /= 256n;
  }
  for (const c of s) {
    if (c !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

function base58CheckValid(s: string): boolean {
  const bytes = base58Decode(s);
  if (!bytes || bytes.length < 5) return false;
  const body = bytes.slice(0, -4);
  const want = sha256(sha256(body)).slice(0, 4);
  return bytes.slice(-4).every((b, i) => b === want[i]);
}

describe("the simulator's test addresses", () => {
  const transparent = [
    SIM_ADDRESSES.yourTransparent,
    SIM_ADDRESSES.exchangeWallet,
    SIM_ADDRESSES.exchangeDeposit,
  ];

  it("look like real transparent addresses", () => {
    for (const a of transparent) {
      expect(a).toMatch(/^t1[1-9A-HJ-NP-Za-km-z]{33}$/);
      expect(classifyZcashAddress(a)).toBe("transparent");
    }
  });

  it("fail the base58check checksum, so every wallet rejects them", () => {
    for (const a of transparent) expect(base58CheckValid(a), a).toBe(false);
  });

  it("the checksum test itself accepts a real address", () => {
    // Without this, a broken test would pass every test address for the wrong reason.
    expect(base58CheckValid("t1VPyM1j4kRbQRzD6fudpv6fzMJzeRoF83x")).toBe(true);
  });

  it("the unified one looks real and fails its bech32m checksum", () => {
    const ua = SIM_ADDRESSES.yourShielded;
    expect(ua).toMatch(/^u1[02-9ac-hj-np-z]{100,}$/);
    expect(classifyZcashAddress(ua)).toBe("unified");
    expect(bech32Decode(ua)).toBeNull();
    expect(decodeUnifiedAddress(ua)).toBeNull();
  });
});
