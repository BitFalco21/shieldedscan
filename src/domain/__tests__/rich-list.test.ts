import { describe, expect, it } from "vitest";
import { shareOfTransparent } from "../rich-list";
import { ADDRESS_LABELS, addressLabel } from "../address-label";

describe("shareOfTransparent", () => {
  it("divides by the transparent total, which is what the page prints beside it", () => {
    // A real measurement: the top 100 held 7,599,628.72 of 12,442,489.71 ZEC.
    expect(shareOfTransparent(759_962_871_975_056, 1_244_248_970_865_356)).toBeCloseTo(0.6108, 4);
  });

  it("returns 0 rather than a division by zero when there is nothing to divide by", () => {
    expect(shareOfTransparent(1, 0)).toBe(0);
  });
});

describe("address labels", () => {
  it("carries a basis and a source on every entry", () => {
    // Every name records its provenance. The basis is not rendered, but it is kept so a
    // self-published address can be told from a third-party attribution.
    for (const [address, label] of Object.entries(ADDRESS_LABELS)) {
      expect(label.name, address).toBeTruthy();
      expect(["self-declared", "external"], address).toContain(label.basis);
      expect(label.source, address).toBeTruthy();
    }
  });

  it("names an address rather than restating it", () => {
    // A label whose name IS the address is a row that says nothing, and it is what a
    // mechanical import produces when a column is misread.
    for (const [address, label] of Object.entries(ADDRESS_LABELS)) {
      expect(label.name, address).not.toBe(address);
      expect(label.name, address).not.toMatch(/^t[13][a-zA-Z0-9]{20,}$/);
    }
  });

  it("keys every entry on a well-formed transparent mainnet address", () => {
    for (const address of Object.keys(ADDRESS_LABELS)) {
      expect(address, address).toMatch(/^t[13][a-zA-Z0-9]{33}$/);
    }
  });

  it("has no name that repeats its own entity", () => {
    // "Coinbase Coinbase Prime Custody" is what joining the source's two columns blindly
    // produces, and it reads as a transcription error rather than a name.
    for (const [address, label] of Object.entries(ADDRESS_LABELS)) {
      const words = label.name.split(" ");
      expect(new Set(words).size, `${address}: ${label.name}`).toBe(words.length);
    }
  });

  it("labels the exchange addresses the owner supplied", () => {
    expect(addressLabel("t1gsBrGZGMyDGZw2icGnMpVBuEGVWip5kH8")?.name).toBe("Binance Cold Wallet");
    expect(addressLabel("t3aPMe94jMKyrgkbH5SSukimvdMFJ59EFhP")?.name).toBe("Gemini Cold Wallet");
    expect(addressLabel("t1ahNXYP7HFi3oJ8G26rjc9wWe5j4ryxxDL")?.name).toBe(
      "Coinbase Prime Custody",
    );
    expect(addressLabel("t3hdTwzcVVGEqDdNKJTBfWvWyaFYNJv7KkA")?.name).toBe("Gemini Custody");
    expect(addressLabel("t1XP8Pjju5eMYVfXiFNNjkjY8kt5ZLL4maJ")?.name).toBe("Binance");
    expect(Object.keys(ADDRESS_LABELS)).toHaveLength(45);
  });

  it("labels the Bitget exploit addresses the owner supplied", () => {
    expect(addressLabel("t1WgMdtND8NF7NDUuYmq8MpMj1NTCXkMDVG")?.name).toBe(
      "BitGet Exploit Sept 2026",
    );
    expect(addressLabel("t1SyhmRJ35RpGsyuLArsPLepyoiLcawLia5")?.name).toBe("DPRK attackers");
    expect(addressLabel("t1gNZpuHEpST6Yu99y1tVb9nKXetkinFgXg")?.name).toBe("DPRK attackers");
  });

  it("returns null for an unlabelled address rather than guessing", () => {
    // Rank 3 on the live rich list, deliberately: it sits between two labelled rows and
    // nobody has attributed it, which is the state nearly every address on the chain is in.
    expect(addressLabel("t1cpC3SS8okUsMQwTqWgzyA1k237B3WCeco")).toBeNull();
    expect(addressLabel("t1FixtureRichAddr00000000000000001")).toBeNull();
  });
});
