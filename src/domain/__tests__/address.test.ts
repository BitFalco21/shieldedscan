import { describe, expect, it } from "vitest";
import { classifyZcashAddress, zcashAddressKindLabel, zcashAddressKindNote } from "../address";

/**
 * Real addresses observed on Maya's ZEC legs (sampled 2026-07-26; 10 of 39 inbound legs
 * landed on a unified address), so the fixtures are live shapes, not invented ones.
 */
const T1 = "t1fwZ9Md8brP9zmYD9jYNfpXDPFVe3LEqYr";
const U1 =
  "u103es06kwh0vumpqutx3kfyy5v8s0np5zyv2u3dq3gqxza78r2s2zh4vekx5x0dznkk2jvlufg0cruvektv588m4l70gcwa8yugd56e25";
const ZS1 = "zs1exampleshieldedsaplingaddressfixture0000000000000001";

describe("classifyZcashAddress", () => {
  it("classifies the three address families", () => {
    expect(classifyZcashAddress(T1)).toBe("transparent");
    expect(classifyZcashAddress(U1)).toBe("unified");
    expect(classifyZcashAddress(ZS1)).toBe("sapling");
  });

  it("accepts t3 script addresses as transparent", () => {
    expect(classifyZcashAddress("t3Vz22vK5z2LcKEdg16Yv4FFneEL1zg9ojd")).toBe("transparent");
  });

  it("returns null rather than guessing, so callers cannot render a fake kind", () => {
    expect(classifyZcashAddress(null)).toBeNull();
    expect(classifyZcashAddress("")).toBeNull();
    expect(classifyZcashAddress("0x09d36eed1dbd19d21ea5df624f60b1f384bb213a")).toBeNull();
    expect(classifyZcashAddress("bc1quyhjuf32amgcns4ujmxhxxng3avg0482ky4y3e")).toBeNull();
    expect(classifyZcashAddress("thor1659mh9va7l9myf88504r7as572mq9c3jwfg9yu")).toBeNull();
  });

  it("tolerates surrounding whitespace", () => {
    expect(classifyZcashAddress(`  ${T1}  `)).toBe("transparent");
  });

  it("classifies TESTNET prefixes too — the testnet deployment 404'd its own shielded addresses before 2026-08-17", () => {
    // Shapes per the Zcash protocol spec: tm/t2 base58check transparent,
    // ztestsapling1 Sapling, utest1 unified.
    expect(classifyZcashAddress("tmEwfaEZL6XZqLbyddgcSQ5eF7cTLQZL4bg")).toBe("transparent");
    expect(classifyZcashAddress("t26YoyZ1iPgiMEWL4zGUm74eVWfhyDMXzY2")).toBe("transparent");
    expect(
      classifyZcashAddress("ztestsapling1exampleshieldedsaplingaddressfixture0000000000000001"),
    ).toBe("sapling");
    expect(classifyZcashAddress(`utest1${"qpw9zx7k3mn4vr8sd2hf6tgy5jc0lb".repeat(4)}`)).toBe(
      "unified",
    );
  });
});

describe("zcashAddressKindLabel", () => {
  it("is the short form, safe to compose into a title", () => {
    expect(zcashAddressKindLabel("unified")).toBe("UNIFIED");
    expect(zcashAddressKindLabel("sapling")).toBe("SAPLING");
    expect(zcashAddressKindLabel("transparent")).toBe("TRANSPARENT");
    expect(zcashAddressKindLabel(null)).toBe("UNKNOWN");
  });
});

describe("zcashAddressKindNote", () => {
  it("never claims a unified address IS shielded — only that it can be", () => {
    // A unified address may carry a transparent receiver, so it is shielded-capable only.
    expect(zcashAddressKindNote("unified")).toBe(
      "shielded-capable — the receiver used is not public",
    );
    expect(zcashAddressKindNote("sapling")).toBe("shielded");
  });

  it("has nothing to qualify for a transparent or unrecognised address", () => {
    expect(zcashAddressKindNote("transparent")).toBeNull();
    expect(zcashAddressKindNote(null)).toBeNull();
  });
});
