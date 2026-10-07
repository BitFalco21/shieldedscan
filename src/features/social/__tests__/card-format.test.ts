import { describe, expect, it } from "vitest";
import { elideCardTxid, formatCardDate } from "../card-format";

describe("formatCardDate", () => {
  it("prints the UTC day upper-cased, with no time of day", () => {
    // 2026-08-04 23:30 UTC: still the 4th in UTC whatever the runner's zone.
    expect(formatCardDate(1_785_886_200)).toBe("04 AUG 2026");
  });
});

describe("elideCardTxid", () => {
  it("keeps ten leading and six trailing characters", () => {
    const txid = "0123456789abcdef".repeat(4);
    expect(elideCardTxid(txid)).toBe("0123456789…abcdef");
  });
});
