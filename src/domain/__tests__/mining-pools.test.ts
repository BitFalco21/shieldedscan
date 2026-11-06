import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ECOSYSTEM_LOGOS } from "@/features/ecosystem/logos.generated";
import { ADDRESS_LABELS } from "../address-label";
import { base58checkDecode } from "../encoding/base58check";
import { MINING_POOLS, MINING_POOL_LABELS, miningPoolOf } from "../mining-pools";

/**
 * The reviewed list, restated by hand so an edit to the registry has to be made twice. Exact
 * equality is also what keeps every held-back address out: none is written down anywhere.
 */
const EXPECTED: Record<string, string> = {
  t1MKn34KBa8Xh4g8qU8psibBXvURafphVn7: "ViaBTC",
  t1SEgZvXCu3ceE42qrq5pCeSq7HbLjX8NJv: "ViaBTC",
  t1at7nVNsv6taLRrNRvnQdtfLNRDfsGc3Ak: "ViaBTC",
  t1ZVi2YGk98tEGYcNpXYnJFWCoLG2oYwv3J: "ViaBTC",
  t1K79TgQbqu74d6rBmsMu2oFEXEwAmdYiT7: "ViaBTC",
  t1SqwRAAdSig6dE4EBPLonAait219VmkUjP: "Foundry USA",
  t1PEp2GJLSdhDfCKqc2J211WKDUS1NfoQNy: "F2Pool",
  t1TVdjqU1APVQmCRRnzbqfjz6wR2qtBnnoc: "Luxor",
  t1XQZdZMnzXBcL8yx2PR27dSNrqctgwLgux: "Luxor",
  t1VTjv7XF3hYqxQkxKmHHErvus3bDrbbkGg: "2Miners",
  t1QxTHUputbmZRxd3EqP671sLqd6KNBQbXJ: "2Miners",
  t1fu6KgYtHEXk2ZhTpM1XD7jbnSmW6wokDM: "2Miners",
  t1bnxtY7aLCjWx9Ru1YcGwRWch3eEWUFK7u: "2Miners",
  t1L2b66MXbgpVMXDfUa94GCBFAN4dCxGohM: "AntPool",
  t1Y2tYgDJnH4m1uQPDXxvXQSh1Jbun3AP22: "KuPool",
  t1e6hceYHkzCbwcwGZzKeMfXXW7x7gr19Cw: "Kryptex",
  t1eBv4a3wBhVaFgWYjXrFYTU7pruCWaBpLW: "NiceHash",
  t1cQA9Rxn31tqHcgZzydrpDjgsQGmjpBgpB: "Mining-Dutch",
  t1Uo7EN1A3GN29UjQJbUFYvrhxQd6Gt7qdA: "ZEC Mining Pool",
};

/** Mainnet P2PKH: version bytes 0x1C 0xB8, then a 20-byte key hash. */
function isMainnetP2pkh(address: string): boolean {
  const payload = base58checkDecode(address);
  return payload !== null && payload.length === 22 && payload[0] === 0x1c && payload[1] === 0xb8;
}

describe("MINING_POOL_LABELS", () => {
  it("names exactly the reviewed addresses, each with its pool", () => {
    const actual = Object.fromEntries(
      Object.entries(MINING_POOL_LABELS).map(([a, l]) => [a, MINING_POOLS[l.miningPool].name]),
    );
    expect(actual).toEqual(EXPECTED);
  });

  it("holds only well-formed mainnet addresses, so a typo cannot name a stranger", () => {
    for (const address of Object.keys(MINING_POOL_LABELS)) {
      expect(isMainnetP2pkh(address), address).toBe(true);
    }
  });

  it("shares no address with ADDRESS_LABELS, so an address never has two names", () => {
    for (const address of Object.keys(MINING_POOL_LABELS)) {
      expect(ADDRESS_LABELS[address], address).toBeUndefined();
    }
  });

  it("records evidence on every entry", () => {
    for (const [address, label] of Object.entries(MINING_POOL_LABELS)) {
      expect(label.evidence.length, address).toBeGreaterThan(20);
    }
  });
});

describe("MINING_POOLS", () => {
  it("keys every pool by its own id", () => {
    for (const [id, pool] of Object.entries(MINING_POOLS)) expect(pool.id).toBe(id);
  });

  it("has unique display names", () => {
    const names = Object.values(MINING_POOLS).map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("points only at committed, reviewed logos", () => {
    for (const pool of Object.values(MINING_POOLS)) {
      if (pool.logo === null) continue;
      expect(ECOSYSTEM_LOGOS.has(pool.logo), pool.logo).toBe(true);
      expect(existsSync(join(process.cwd(), "public/ecosystem/logos", `${pool.logo}.png`))).toBe(
        true,
      );
    }
  });
});

describe("miningPoolOf", () => {
  it("resolves a labelled payout address to its pool", () => {
    expect(miningPoolOf("t1SEgZvXCu3ceE42qrq5pCeSq7HbLjX8NJv")).toEqual({
      id: "viabtc",
      name: "ViaBTC",
      logo: "viabtc",
    });
  });

  it("is null for any other address, never a guess", () => {
    expect(miningPoolOf("t1cpC3SS8okUsMQwTqWgzyA1k237B3WCeco")).toBeNull();
    // A near miss: one character off a labelled address names nobody.
    expect(miningPoolOf("t1SEgZvXCu3ceE42qrq5pCeSq7HbLjX8NJw")).toBeNull();
  });
});
