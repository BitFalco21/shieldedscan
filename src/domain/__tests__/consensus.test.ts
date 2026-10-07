import { describe, expect, it } from "vitest";
import { NU7, feeDestinationSentence, nu7ActiveAt, targetSpacingSeconds } from "@/domain";

const TESTNET_NU7 = NU7.activationHeight.testnet!;

describe("targetSpacingSeconds", () => {
  it("steps 150 → 75 at Blossom and 75 → 25 at NU7 on testnet, at the exact heights", () => {
    expect(targetSpacingSeconds("testnet", 583_999)).toBe(150);
    expect(targetSpacingSeconds("testnet", 584_000)).toBe(75);
    expect(targetSpacingSeconds("testnet", TESTNET_NU7 - 1)).toBe(75);
    expect(targetSpacingSeconds("testnet", TESTNET_NU7)).toBe(25);
  });

  it("is unchanged on mainnet while its NU7 height is unset — nothing visible moves early", () => {
    expect(NU7.activationHeight.mainnet).toBeNull();
    expect(targetSpacingSeconds("mainnet", 653_599)).toBe(150);
    expect(targetSpacingSeconds("mainnet", 653_600)).toBe(75);
    expect(targetSpacingSeconds("mainnet", 99_000_000)).toBe(75);
  });
});

describe("fees across NU7", () => {
  it("describes a fee by its own block's rules, so an old block keeps its true sentence", () => {
    expect(feeDestinationSentence("testnet", TESTNET_NU7 - 1)).toMatch(
      /All of it goes to the miner/,
    );
    expect(feeDestinationSentence("testnet", TESTNET_NU7)).toMatch(/40% of it goes to the miner/);
    // "Removed", never "burned": the 60% is reissued through later block rewards (ZIP 237).
    expect(feeDestinationSentence("testnet", TESTNET_NU7)).not.toMatch(/burn/i);
  });

  it("knows NU7 is active on testnet and not on mainnet", () => {
    expect(nu7ActiveAt("testnet", TESTNET_NU7)).toBe(true);
    expect(nu7ActiveAt("mainnet", 3_506_000)).toBe(false);
  });
});
