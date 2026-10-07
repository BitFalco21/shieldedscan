import { describe, expect, it } from "vitest";
import type { CrossChainTransfer } from "@/domain";
import type { ActionPart } from "@/domain";
import { formatZecAmount } from "@/lib/format";
import { transferAction } from "../transferAction";

/** The sentence as a reader hears it; chips as `[label]`, the venue as `<venue>`. */
function read(parts: readonly ActionPart[]): string {
  return parts
    .map((p) => {
      switch (p.kind) {
        case "text":
        case "verb":
          return p.text;
        case "zec":
          return `${p.zat === null ? "▓" : formatZecAmount(p.zat)} ZEC`;
        case "asset":
          return `${p.amount} ${p.ticker}`;
        case "chain":
          return `[${p.label}]`;
        case "venue":
          return `${p.before ?? ""}<${p.protocol}>`;
        default:
          return `{${p.kind}}`;
      }
    })
    .join("");
}

const inbound: CrossChainTransfer = {
  id: "near-1",
  direction: "in",
  protocol: "near-intents",
  counterpartChain: "BTC",
  counterpartAsset: "BTC",
  counterpartAmount: 15.04,
  counterpartIsSynthetic: false,
  counterpartTxHash: null,
  counterpartAddress: null,
  zcashTxid: null,
  zcashAddress: null,
  zecAmountZat: 125_000_000_000,
  usdValueAtSwap: 1_637_675,
  counterpartUsdAtSwap: null,
  status: "completed",
  timestamp: 1_783_875_480,
} as CrossChainTransfer;

describe("transferAction", () => {
  it("reads an inbound swap source-first, the far chain before Zcash", () => {
    expect(read(transferAction(inbound).parts)).toBe(
      "Swapped 15.04 BTC on [Bitcoin] for 1,250.00 ZEC on [Zcash] via <near-intents>",
    );
  });

  it("reads an outbound swap Zcash-first", () => {
    const out = {
      ...inbound,
      direction: "out",
      counterpartChain: "ETH",
      counterpartAsset: "ETH",
      counterpartAmount: 113.2,
      protocol: "maya",
    } as CrossChainTransfer;
    expect(read(transferAction(out).parts)).toBe(
      "Swapped 1,250.00 ZEC on [Zcash] for 113.2 ETH on [Ethereum] via <maya>",
    );
  });

  it("leaves out a counterpart amount the venue has not published, rather than inventing one", () => {
    const pending = {
      ...inbound,
      counterpartAmount: null,
      status: "pending",
    } as CrossChainTransfer;
    const sentence = read(transferAction(pending).parts);
    expect(sentence).toBe("Swapping 1,250.00 ZEC on [Zcash] from [Bitcoin] via <near-intents>");
    expect(sentence).not.toContain("—");
  });

  it("names wrapped ZEC as wrapped, so a crossing does not read as a swap with itself", () => {
    const wrapped = {
      ...inbound,
      direction: "out",
      counterpartChain: "MAYA",
      counterpartAsset: "ZEC/ZEC",
      counterpartAmount: 1000,
      counterpartIsSynthetic: true,
      protocol: "maya",
    } as CrossChainTransfer;
    expect(read(transferAction(wrapped).parts)).toContain("1,000 ZEC/ZEC (wrapped ZEC) on");
  });

  it("says only the Zcash leg is checked here, about the far side only", () => {
    expect(transferAction(inbound).farSideNote).toMatch(/only the Zcash leg is checked here/);
    expect(transferAction(inbound).farSideNote).not.toMatch(/recipient/);
  });
});
