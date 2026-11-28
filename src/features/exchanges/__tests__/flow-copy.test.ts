import { describe, expect, it } from "vitest";
import { phoneZec } from "../flow-copy";

const zec = (n: number) => Math.round(n * 100_000_000);

describe("phoneZec", () => {
  it("keeps the digits a reader needs: 2,166.92 is 2.17K, never 2.2K", () => {
    expect(phoneZec(zec(2_166.9225402))).toBe("2.17K");
    expect(phoneZec(zec(9_999.4))).toBe("10.00K");
    expect(phoneZec(zec(22_712))).toBe("22.7K");
    expect(phoneZec(zec(451_903))).toBe("451.9K");
    expect(phoneZec(zec(1_493_702))).toBe("1.49M");
  });

  it("never reads a real amount below a coin as zero", () => {
    expect(phoneZec(30_000)).toBe("0.0003");
    expect(phoneZec(zec(654.49))).toBe("654.49");
    expect(phoneZec(0)).toBe("0.00");
  });
});
