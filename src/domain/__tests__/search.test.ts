import { describe, expect, it } from "vitest";
import { classifySearchQuery } from "../search";

describe("classifySearchQuery", () => {
  it("empty", () => {
    expect(classifySearchQuery("  ")).toEqual({ type: "empty" });
  });
  it("height", () => {
    expect(classifySearchQuery("2481032")).toEqual({ type: "height", height: 2481032 });
  });
  it("64-hex could be block hash or txid", () => {
    const h = "A".repeat(64);
    expect(classifySearchQuery(h)).toEqual({ type: "hash64", hash: "a".repeat(64) });
  });
  it("transparent address", () => {
    expect(classifySearchQuery("t1XWk29dExampleFixture00000001")).toEqual({
      type: "transparent-address",
      address: "t1XWk29dExampleFixture00000001",
    });
  });
  it("shielded addresses (sapling + unified)", () => {
    expect(classifySearchQuery("zs1exampleexampleexampleexample").type).toBe("shielded-address");
    expect(classifySearchQuery("u1exampleexampleexampleexample0").type).toBe("shielded-address");
  });
  it("garbage is invalid", () => {
    expect(classifySearchQuery("hello world")).toEqual({ type: "invalid", query: "hello world" });
  });
  it("a Zcash name, in any case and with or without .zcash, normalised to the bare name", () => {
    expect(classifySearchQuery(" Zenith.ZCASH ")).toEqual({
      type: "name",
      name: "zenith",
      query: "Zenith.ZCASH",
    });
    expect(classifySearchQuery("0xbtc")).toMatchObject({ type: "name", name: "0xbtc" });
  });
  it("`.zec` reaches the same name as `.zcash` — ZNS treats them as one", () => {
    expect(classifySearchQuery("zechariah.zec")).toMatchObject({ type: "name", name: "zechariah" });
    expect(classifySearchQuery(" Zenith.ZEC ")).toMatchObject({ type: "name", name: "zenith" });
    // The ending needs its dot: `zec` alone is a name, not an empty one.
    expect(classifySearchQuery("zec")).toMatchObject({ type: "name", name: "zec" });
    expect(classifySearchQuery("zcash.zec")).toMatchObject({ type: "name", name: "zcash" });
  });
  it("addresses, heights and hashes outrank a name — an all-digit name reads as a height", () => {
    expect(classifySearchQuery("2024").type).toBe("height");
    expect(classifySearchQuery("u1exampleexampleexampleexample0").type).toBe("shielded-address");
  });
  it("anything the registry could not hold is still invalid", () => {
    expect(classifySearchQuery("a".repeat(63)).type).toBe("invalid");
    expect(classifySearchQuery("zen_ith").type).toBe("invalid");
    expect(classifySearchQuery("zenith.zcash.zcash").type).toBe("invalid");
    expect(classifySearchQuery(".zcash").type).toBe("invalid");
    expect(classifySearchQuery(".zec").type).toBe("invalid");
    // One ending is stripped, never two.
    expect(classifySearchQuery("zenith.zec.zcash").type).toBe("invalid");
    expect(classifySearchQuery("zenith.zcash.zec").type).toBe("invalid");
  });
});
