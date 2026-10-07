import { describe, expect, it } from "vitest";
import { getZipIndex } from "@/fixtures/zips";
import { isZipIndex, narrowZipIndex, NO_NARROWING } from "../zip-index";
import { AgentTools, sourceLinkFor } from "../tools";
import { FIXTURE_NOW_MS, makeChain, makeV1 } from "../testing/fixture-world";

const index = getZipIndex();
const tools = () => new AgentTools(makeV1(), makeChain(), () => FIXTURE_NOW_MS);
const call = (args: Record<string, unknown>) => tools().dispatch("zip_index", JSON.stringify(args));

describe("narrowZipIndex", () => {
  it("files every row under exactly one of the page's four sections, unnarrowed", () => {
    const p = narrowZipIndex(index, NO_NARROWING);
    const filed =
      p.sections.inForce.length +
      p.sections.proposed.length +
      p.sections.draft.length +
      p.sections.retired.length;
    expect(filed).toBe(index.zips.length);
    expect(p.matched).toBe(index.zips.length);
    expect(p.zipsIndexed).toBe(index.zips.length);
    expect(p.narrowing).toBe("none");
    expect(p.asOfUtc).toBe(new Date(index.asOf * 1000).toISOString());
  });

  it("derives every url from the NUMBER, never from fetched text", () => {
    const p = narrowZipIndex(index, NO_NARROWING);
    for (const s of Object.values(p.sections)) {
      for (const r of s)
        expect(r.url).toBe(`https://zips.z.cash/zip-${String(r.zip).padStart(4, "0")}`);
    }
  });

  it("narrows to one ZIP, and a number that is not a ZIP matches nothing rather than erring", () => {
    const one = narrowZipIndex(index, { zip: [213], section: null, query: null });
    expect(one.matched).toBe(1);
    expect(one.sections.inForce[0]?.title).toBe("Shielded Coinbase");
    expect(one.zipsIndexed).toBe(index.zips.length);
    const none = narrowZipIndex(index, { zip: [9999], section: null, query: null });
    expect(none.matched).toBe(0);
    expect(none.notIndexed).toEqual([9999]);
  });

  it("narrows to several ZIPs at once and NAMES the requested numbers it does not hold", () => {
    const p = narrowZipIndex(index, { zip: [213, 9999], section: null, query: null });
    expect(p.matched).toBe(1);
    expect(p.notIndexed).toEqual([9999]);
  });

  it("omits notIndexed when no number was asked, since [] would claim every one was found", () => {
    expect(narrowZipIndex(index, NO_NARROWING)).not.toHaveProperty("notIndexed");
  });

  it("keeps a multi-revision status WHOLE and an unrecognised one verbatim under draft", () => {
    const p = narrowZipIndex(index, NO_NARROWING);
    const all = Object.values(p.sections).flat();
    expect(
      all.some((r) => /\[Revision 0.*\] Final, \[Revision 2.*\] Proposed/.test(r.status)),
    ).toBe(true);
    expect(p.sections.draft.some((r) => r.status === "Percolating")).toBe(true);
  });

  it("matches a title query case-insensitively, combined with a section", () => {
    const p = narrowZipIndex(index, { zip: null, section: "in-force", query: "COINBASE" });
    expect(p.matched).toBe(1);
    expect(p.sections.inForce[0]?.zip).toBe(213);
    expect(p.sections.draft).toHaveLength(0);
  });

  it("accepts the tracker's shape and refuses anything else", () => {
    expect(isZipIndex(index)).toBe(true);
    expect(isZipIndex({ asOf: 1, source: "x", skippedFiles: 0, zips: [{ zip: "213" }] })).toBe(
      false,
    );
    expect(isZipIndex(null)).toBe(false);
  });
});

describe("zip_index tool", () => {
  it("dispatches to the private ZIP route inside a <data> envelope, sectioned", async () => {
    const result = await call({});
    expect(result.endpoints).toEqual([`GET /chain/zips`]);
    expect(result.content).toMatch(/^<data source="GET \/chain\/zips"/m);
    expect(result.content).toContain('"inForce"');
    expect(result.content).toContain("Shielded Coinbase");
    expect(result.content).toContain("https://zips.z.cash/zip-0213");
    // The note is ours and sits OUTSIDE the envelope, so it cannot be mistaken for data.
    expect(result.content.indexOf("INDEX OF LABELS")).toBeLessThan(result.content.indexOf("<data"));
  });

  it("a ZIP number that does not exist is an ANSWER, never our outage", async () => {
    const result = await call({ zip: 9999 });
    expect(result.content).not.toContain("THIS READ FAILED");
    expect(result.content).toContain('"matched": 0');
  });

  it("rejects a section the schema does not know, and a fractional number, as a message", async () => {
    const bad = await call({ section: "final" });
    expect(bad.content).toMatch(/section must be one of/);
    expect(bad.endpoints).toEqual([]);
    const frac = await call({ zip: 3.5 });
    expect(frac.content).toMatch(/whole number/);
    const fracInList = await call({ zip: [213, 3.5] });
    expect(fracInList.content).toMatch(/whole number/);
    expect(fracInList.endpoints).toEqual([]);
    const empty = await call({ zip: [] });
    expect(empty.content).toMatch(/at least one/);
    const tooMany = await call({ zip: Array.from({ length: 21 }, (_, i) => i) });
    expect(tooMany.content).toMatch(/at most 20/);
  });

  it("answers a LIST in one dispatch, and still accepts the bare number the schema used to take", async () => {
    const list = await call({ zip: [213, 9999, 213] });
    expect(list.endpoints).toEqual([`GET /chain/zips`]);
    expect(list.content).toContain("Shielded Coinbase");
    expect(list.content).toMatch(/"notIndexed": \[\s*9999\s*\]/);
    const bare = await call({ zip: 213 });
    expect(bare.content).toContain("Shielded Coinbase");
    expect(bare.content).toMatch(/"notIndexed": \[\]/);
  });

  it("cites the /zips page, never the token-gated route", () => {
    expect(sourceLinkFor("GET /chain/zips")).toEqual({ label: "ZIP index", href: "/zips" });
  });
});
