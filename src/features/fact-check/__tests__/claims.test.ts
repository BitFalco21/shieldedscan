import { describe, expect, it } from "vitest";
import { CLAIMS, CLAIM_GROUPS, VERDICT_LABEL } from "../claims";

/**
 * The content rules for `/fact-check`, pinned so they cannot drift one edit at a time. A test
 * that fails here is a content decision being reversed, which should happen in the open.
 */
const allProse = CLAIMS.flatMap((c) => [c.claim, ...c.answer]).join("\n");

describe("the fact-check claims", () => {
  it("gives every claim a unique, anchor-safe id and a group that exists", () => {
    const ids = CLAIMS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    const groups = new Set(CLAIM_GROUPS.map((g) => g.id));
    for (const c of CLAIMS) expect(groups.has(c.group)).toBe(true);
    for (const g of CLAIM_GROUPS) expect(CLAIMS.some((c) => c.group === g.id)).toBe(true);
  });

  it("keeps every answer short — one to four sentences, under 130 words", () => {
    for (const c of CLAIMS) {
      expect(c.answer.length, c.id).toBeGreaterThanOrEqual(1);
      expect(c.answer.length, c.id).toBeLessThanOrEqual(4);
      const words = c.answer.join(" ").split(/\s+/).length;
      expect(words, `${c.id} has ${words} words`).toBeLessThan(130);
    }
  });

  it("sources every claim, with at least one primary document off this site", () => {
    for (const c of CLAIMS) {
      expect(c.sources.length, c.id).toBeGreaterThan(0);
      expect(
        c.sources.some((s) => s.href.startsWith("https://")),
        `${c.id} cites only this site`,
      ).toBe(true);
      for (const s of c.sources) {
        expect(s.href, s.label).toMatch(/^(https:\/\/|\/)/);
        // A real UTC day that round-trips — `Date.parse("2026-02-31")` would roll into March.
        expect(s.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(new Date(`${s.verifiedOn}T00:00:00Z`).toISOString().slice(0, 10)).toBe(s.verifiedOn);
      }
    }
  });

  it("concedes the counterfeiting bugs instead of refuting them", () => {
    // Two undetectable-counterfeiting flaws existed (Sprout, fixed 2018; Orchard, 2022 until
    // 2026-06-01). A page that called hidden inflation FALSE would be debunked with one link.
    const inflation = CLAIMS.find((c) => c.id === "hidden-inflation");
    expect(inflation?.verdict).toBe("partly-true");
    expect(inflation?.answer.join(" ")).toMatch(/Sprout/);
    expect(inflation?.answer.join(" ")).toMatch(/Orchard.*2022/);
    // And the trusted-setup answer must not claim Sprout's setup was flawless: its BCTV14
    // key generation left forging elements in the ceremony transcript.
    expect(CLAIMS.find((c) => c.id === "trusted-setup")?.answer.join(" ")).toMatch(/real flaw/);
  });

  it("calls the intelligence claim UNFOUNDED, never FALSE", () => {
    // The absence of a backdoor cannot be certified — a flaw sat undetected in public Orchard
    // code for four years — so the honest verdict is that nothing supports the claim.
    expect(CLAIMS.find((c) => c.id === "intelligence-backdoor")?.verdict).toBe("unfounded");
  });

  it("names no individual, as nowhere on this site does", () => {
    // The people behind the papers and disclosures cited here, by the names those sources
    // print. Organisations are named; people are not.
    for (const name of [
      "Ben-Sasson",
      "Chiesa",
      "Garman",
      "Green",
      "Miers",
      "Tromer",
      "Virza",
      "Hornby",
      "Wilcox",
      "Zooko",
      "Gabizon",
      "Kappos",
      "Meiklejohn",
    ]) {
      expect(allProse).not.toMatch(new RegExp(`\\b${name}\\b`));
    }
  });

  it("describes Monero only as far as its own publications support", () => {
    // Each statement about Monero is sourced to Monero's own project. The default-on privacy is
    // conceded rather than denied, and the planned full-chain upgrade is named with the day it
    // was checked, so the answer cannot be debunked by one link to either.
    const better = CLAIMS.find((c) => c.id === "monero-better-privacy");
    expect(better?.verdict).toBe("misleading");
    expect(better?.answer.join(" ")).toMatch(/by default/);
    expect(better?.answer.join(" ")).toMatch(/has not activated/);
    expect(better?.sources.some((s) => s.href.includes("getmonero.org"))).toBe(true);
    expect(CLAIMS.find((c) => c.id === "criminals-use-monero")?.verdict).toBe("misleading");
    expect(allProse).not.toMatch(/\bxmr\b/i);
  });

  it("uses only words the site-wide value sweeps allow", () => {
    expect(allProse).not.toMatch(/\bnull\b|\bundefined\b|\bNaN\b/);
    expect(allProse).not.toMatch(/privacy score/i);
  });

  it("labels every verdict it uses", () => {
    for (const c of CLAIMS) expect(VERDICT_LABEL[c.verdict]).toBeTruthy();
  });
});
