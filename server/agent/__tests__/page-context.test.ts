import { describe, expect, it } from "vitest";
import { ASK_PAGES, isAskPage } from "../ask-pages";
import { pageContext } from "../page-context";
import { SITE_PAGES } from "../site-guide";

/**
 * What Zeno is told about the page a question came from. The page description is read from the site
 * guide rather than restated, so the two cannot drift; the rest is the rules that make an answer on
 * that page a guide's answer.
 */
describe("pageContext", () => {
  it("describes the learning page in the site guide's own words", () => {
    expect(pageContext("learn")).toContain(SITE_PAGES["/learn"]!.what);
  });

  it("tells Zeno the reader is new, and to point at the page's next step", () => {
    const context = pageContext("learn");
    expect(context).toMatch(/new to Zcash/);
    expect(context).toMatch(/next step on the page/);
  });

  it("keeps the safety rules: never ask for what only the reader should hold", () => {
    const context = pageContext("learn");
    for (const secret of ["recovery phrase", "viewing key", "address", "transaction ID"]) {
      expect(context).toContain(secret);
    }
    expect(context).toMatch(/Never ask for/);
    // It vouches for no wallet or exchange: support changes, and the page links a list instead.
    expect(context).toMatch(/do not recommend a specific wallet or exchange/);
  });

  it("holds no figure, so nothing in it can go stale", () => {
    // A number in a system message goes stale silently; the only digits allowed are the ones inside
    // the site guide's own sentence.
    const own = pageContext("learn").replace(SITE_PAGES["/learn"]!.what, "");
    expect(own).not.toMatch(/\d/);
  });
});

describe("the pages a question may name", () => {
  it("is a closed set the gate can check", () => {
    for (const page of ASK_PAGES) expect(isAskPage(page)).toBe(true);
    expect(isAskPage("ai-agent")).toBe(false);
    expect(isAskPage(undefined)).toBe(false);
  });
});
