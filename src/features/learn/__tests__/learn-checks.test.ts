import { describe, expect, it } from "vitest";
import { DONATION_ADDRESS } from "@/lib/donation";
import { SIM_ADDRESSES } from "../sim-model";
import {
  checkAddress,
  looksLikeRecoveryPhrase,
  ownTransparentAddresses,
  stepVerdict,
} from "../learn-checks";

describe("stepVerdict", () => {
  it("accepts every way ZEC can arrive at step 2, and says when step 3 is not needed", () => {
    expect(stepVerdict("receive", "transparent")).toEqual({ ok: true, skipsShield: false });
    expect(stepVerdict("receive", "shielding")).toEqual({ ok: true, skipsShield: true });
    expect(stepVerdict("receive", "shielded")).toEqual({ ok: true, skipsShield: true });
    expect(stepVerdict("receive", "unshielding").ok).toBe(false);
  });

  it("catches the beginner's real mistakes with a sentence that says what to do", () => {
    const shield = stepVerdict("shield", "transparent");
    expect(shield.ok).toBe(false);
    expect(!shield.ok && shield.message).toContain("Shield action");

    const send = stepVerdict("send", "unshielding");
    expect(!send.ok && send.message).toContain("u1… or zs1…");

    const unshield = stepVerdict("unshield", "shielded");
    expect(!unshield.ok && unshield.message).toContain("t1");
  });

  it("accepts exactly the shape each step is about", () => {
    expect(stepVerdict("shield", "shielding").ok).toBe(true);
    expect(stepVerdict("send", "shielded").ok).toBe(true);
    expect(stepVerdict("unshield", "unshielding").ok).toBe(true);
  });
});

describe("checkAddress", () => {
  it("decodes a real unified address's receivers in the browser", () => {
    const check = checkAddress(DONATION_ADDRESS);
    expect(check.kind).toBe("unified");
    if (check.kind === "unified") {
      expect(check.receivers.map((r) => r.kind).sort()).toEqual(["orchard", "sapling"]);
    }
  });

  it("accepts a real transparent address and calls a changed character a typo", () => {
    expect(checkAddress("t1VPyM1j4kRbQRzD6fudpv6fzMJzeRoF83x")).toEqual({
      kind: "transparent",
      address: "t1VPyM1j4kRbQRzD6fudpv6fzMJzeRoF83x",
    });
    expect(checkAddress("t1VPyM1j4kRbQRzD6fudpv6fzMJzeRoF83y")).toEqual({
      kind: "typo",
      addressKind: "transparent",
    });
  });

  it("calls the simulator's test addresses typos, because they are deliberately broken", () => {
    expect(checkAddress(SIM_ADDRESSES.yourTransparent).kind).toBe("typo");
    expect(checkAddress(SIM_ADDRESSES.yourShielded).kind).toBe("typo");
  });

  it("names a testnet address as one, and refuses a recovery phrase outright", () => {
    expect(checkAddress("tmBsTi2xWTjUdEXnuTceL7fecEQKeWaPDJd").kind).toBe("testnet");
    const phrase =
      "abandon ability able about above absent absorb abstract absurd abuse access accident";
    expect(looksLikeRecoveryPhrase(phrase)).toBe(true);
    expect(checkAddress(phrase).kind).toBe("phrase");
    expect(checkAddress("hello").kind).toBe("invalid");
    expect(checkAddress("   ").kind).toBe("empty");
  });
});

describe("ownTransparentAddresses", () => {
  it("is the pasted t-address, or a unified address's transparent receiver, or nothing", () => {
    expect([
      ...ownTransparentAddresses(checkAddress("t1VPyM1j4kRbQRzD6fudpv6fzMJzeRoF83x")),
    ]).toEqual(["t1VPyM1j4kRbQRzD6fudpv6fzMJzeRoF83x"]);
    expect(ownTransparentAddresses(checkAddress(DONATION_ADDRESS)).size).toBe(0);
    expect(ownTransparentAddresses(null).size).toBe(0);
  });
});
