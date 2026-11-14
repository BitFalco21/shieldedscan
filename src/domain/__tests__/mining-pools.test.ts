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
  t1Zdu26WGAzCJR1waaTUNMRx57nHbwdjTd2: "Luxor",
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
  // Earlier years.
  t1godRk4oKt689om4Q3CbmA9wsuhm1rUvLR: "ViaBTC",
  t1aZvxRLCGVeMPFXvqfnBgHVEbi4c6g8MVa: "F2Pool",
  t1YN48pMwyG4aszU411jKdY7MHyPpJB8jPq: "F2Pool",
  t1ZYZS6ynUDbvht7vH3dMiM3rsAJ1p6EGWC: "AntPool",
  t1a4eP8SuDGVizftxMcFh9DEDYi1XzKarfz: "AntPool",
  t1Xvjk8XQZ6S87n83ZCHRdoFJ8GZ7sq4FZN: "AntPool",
  t1bo889qq1f24fEwEC5efozKWfAvWe3tEww: "AntPool",
  t1L2rjgGrvEqfrA5zqUca4GGxAeQg47CTpG: "Luxor",
  t1dzbQ2bnAGwBVHZykfKYTQYyZY1AjrS1Mg: "2Miners",
  t1NSiJnvv1A6uUfkLj4Zi6cLMqQ44SC8ja4: "2Miners",
  t1LRTUjrLE2RHsS75cjCrxB7xaLTwaVkwao: "2Miners",
  t1Pxv9u2jWySHJPFpKimYMAtEbdHEvuYdS2: "2Miners",
  t1ajyFP7GnauoDFaM8MqJx9ouQjKS3tbA7g: "2Miners",
  t1QmwNr6jNRqGSojh1yHjzfL3EhCsG6LxC7: "Poolin",
  t1bJgWJgHgrs6K9L96T9tSK1EBs3iNSzfJq: "Poolin",
  t1dDC48of9TQH2ewNb7za7x5ZiCT2Fo4xC6: "Poolin",
  t1ZMXcX4ccb7DNoN2nPDEfhWqLtAGeQ2obE: "Poolin",
  t1bzsJ7mRyHwsuXEPMud32SFTjLJ7FrWfpf: "Poolin",
  t1fD2SKAFthHmZmGDfekQFW11M6m2kPYpe7: "Poolin",
  t1XepX38RxS3o5hLioLbaNb6Fa2Y2Be55xw: "Flypool",
  t1ZJQNuop1oytQ7ow4Kq8o9if3astavba5W: "Flypool",
  t1VpYecBW4UudbGcy4ufh61eWxQCoFaUrPs: "Flypool",
  t1Xk6GeseeV8FSDpgr359yL2LmaRtUdWgaq: "Coinotron",
  t1Tqy2u2qgTdcVf7TRxC2KGrxwcuzfdgnSf: "Coinotron",
  t1Z4fP81GQcwfpTYuRafeM1ACfyZUoNRKaB: "Coinotron",
  t1fypqjbxSoiq27rFfXuE6iTHkoBXXpY1J4: "Coinotron",
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
