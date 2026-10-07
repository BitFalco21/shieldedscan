import { describe, expect, it } from "vitest";
import { searchSuggestions } from "../search-suggestions";

describe("search suggestions", () => {
  it("offers a block for a height", () => {
    const [s] = searchSuggestions("2481032");
    expect(s?.href).toBe("/block/2481032");
    expect(s?.detail).toBe("#2,481,032");
  });

  it("offers ONE row for a 64-hex string, with the ambiguity in its label", () => {
    // A txid and a block hash are indistinguishable by shape. Two speculative rows would
    // flash a wrong reading until the resolver answered, so the single row names both and
    // delegates to /search, which resolves server-side.
    const hash = "ab".repeat(32);
    const out = searchSuggestions(hash);
    expect(out).toHaveLength(1);
    expect(out[0]?.href).toBe(`/search?q=${hash}`);
    expect(out[0]?.label).toMatch(/transaction/i);
    expect(out[0]?.label).toMatch(/block/i);
  });

  it("distinguishes transparent from shielded addresses", () => {
    const t = searchSuggestions("t1XWk29dAliceFixtureAddr000001");
    expect(t[0]?.label).toBe("Transparent address");
    const z = searchSuggestions(
      "u1a4w9rqrv2knrp58qa5cwak545ul30rq4txh0nfs7hytjxlpcpswhzpattjx9w7c6",
    );
    expect(z[0]?.label).toBe("Shielded address");
  });

  it("offers nothing for empty or malformed input", () => {
    // Inventing a destination for a malformed string teaches the reader we found something.
    expect(searchSuggestions("")).toEqual([]);
    expect(searchSuggestions("   ")).toEqual([]);
    expect(searchSuggestions("hello world")).toEqual([]);
    expect(searchSuggestions(`${"ab".repeat(31)}c`)).toEqual([]); // one byte short of a hash
    expect(searchSuggestions("<script>alert(1)</script>")).toEqual([]);
  });

  it("gives a name only a gate row, which the hook never shows on its own", () => {
    expect(searchSuggestions("Zenith.zcash")).toEqual([
      { href: "/search?q=zenith", label: "Zcash name", detail: "zenith.zcash" },
    ]);
    expect(searchSuggestions("zenith.zec")).toEqual([
      { href: "/search?q=zenith", label: "Zcash name", detail: "zenith.zcash" },
    ]);
  });

  it("never builds a destination it did not classify", () => {
    // Every href must point at a route that exists, with the value embedded verbatim.
    // /search?q= is the one indirect destination: it is where the ambiguous 64-hex row
    // delegates, and the /search route resolves it server-side.
    for (const q of ["1", "999999999", "ff".repeat(32), "t1abc"]) {
      for (const s of searchSuggestions(q)) {
        expect(s.href).toMatch(/^\/(block\/|tx\/|address\/|search\?q=)/);
      }
    }
  });
});
