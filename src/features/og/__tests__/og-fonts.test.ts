import { describe, expect, it } from "vitest";
import { transactionsById } from "@/fixtures/transactions";
import { mempoolTransactions } from "@/fixtures/mempool";
import { JBM_EXTRABOLD_B64, JBM_REGULAR_B64 } from "../fonts.generated";
import { txCardFacts } from "../tx-card-facts";
import { siteCardFacts } from "../site-card-facts";
import { compareToZec, eligibleAssets } from "@/domain";
import { getMarketSnapshot } from "@/fixtures/market";
import { compareCardFacts } from "../compare-card-facts";
import { getZnsName } from "@/fixtures/zns";
import { nameCardFacts } from "../name-card-facts";

/**
 * Every character the share card can print, against the font that has to draw it.
 *
 * The card's type is a subset (`brand/subset-og-fonts.py`, ~7 KB a face), which keeps it small
 * inside a function bundle and makes a missing glyph likely: a character outside the subset
 * renders as a blank box in an image nobody here sees. So the strings are enumerated from the
 * real fixtures and held against the font's own cmap. The redaction bar is drawn, not typed;
 * if it is ever replaced with ▓, this test fails.
 */
const FACES = { regular: JBM_REGULAR_B64, extrabold: JBM_EXTRABOLD_B64 };
const PRICES = { dailyUsd: { "2026-08-30": 700 }, currentUsd: 650, nowSeconds: 1_756_598_400 };

/** Every codepoint in a TTF's format-4 cmap, read from the table — no font library needed. */
function coveredCodepoints(base64: string): Set<number> {
  const buf = Buffer.from(base64, "base64");
  const numTables = buf.readUInt16BE(4);
  let cmap = -1;
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    if (buf.subarray(rec, rec + 4).toString("ascii") === "cmap") cmap = buf.readUInt32BE(rec + 8);
  }
  expect(cmap, "no cmap table in the subset font").toBeGreaterThan(0);
  const points = new Set<number>();
  const subtables = buf.readUInt16BE(cmap + 2);
  for (let i = 0; i < subtables; i++) {
    const sub = cmap + buf.readUInt32BE(cmap + 4 + i * 8 + 4);
    if (buf.readUInt16BE(sub) !== 4) continue;
    const segX2 = buf.readUInt16BE(sub + 6);
    const ends = sub + 14;
    const starts = ends + segX2 + 2;
    for (let s = 0; s < segX2 / 2; s++) {
      const end = buf.readUInt16BE(ends + s * 2);
      const start = buf.readUInt16BE(starts + s * 2);
      if (start === 0xffff) continue;
      for (let c = start; c <= end; c++) points.add(c);
    }
  }
  return points;
}

/** Every string either card shape can print, over every transaction the fixtures hold. */
function everyCardString(): string[] {
  const out: string[] = ["./shieldedscan", "VALUE", "FEE", "SHIELDED BY DESIGN", "none", "unknown"];
  for (const tx of [...transactionsById.values(), ...mempoolTransactions]) {
    const facts = txCardFacts(tx, PRICES);
    out.push(facts.verdict, facts.stamp, facts.shape, facts.txidShort, facts.host);
    if (facts.path !== null) out.push(facts.path);
    if (facts.value?.kind === "public") {
      out.push(facts.value.zec, facts.value.usd ?? "", facts.value.usdBasis ?? "");
    }
    if (facts.fee?.kind === "amount") out.push(facts.fee.zec);
  }
  const site = siteCardFacts();
  out.push(site.verdict, site.stamp, site.shape, site.host);
  // The name card, over every fixture name that has one, plus its fallback stamp.
  out.push("ZCASH NAME");
  for (const n of ["zenith", "abraham"]) {
    const facts = nameCardFacts(getZnsName(n))!;
    out.push(facts.name, facts.addressShort, facts.since, facts.stamp, facts.host);
  }
  // Every character a name or a unified address can hold, since live names are not fixtures.
  out.push("abcdefghijklmnopqrstuvwxyz0123456789.zcash", "FOR SALE");
  for (const verb of ["CLAIMED", "UPDATED", "BOUGHT"]) out.push(verb);
  out.push("JANUARY FEBRUARY MARCH APRIL MAY JUNE JULY AUGUST SEPTEMBER OCTOBER NOVEMBER DECEMBER");
  // The compare card, over every asset the fixture market offers. Same font, same subset.
  const market = getMarketSnapshot();
  out.push("WITH THE MARKET CAP OF", "ONE ZEC WOULD BE WORTH", "arithmetic, not a forecast");
  out.push("price", "market cap", "→");
  for (const asset of eligibleAssets(market)) {
    const facts = compareCardFacts(market, compareToZec(market.zec, asset)!);
    for (const s of [facts.zec, facts.other]) {
      out.push(s.name, s.ticker, s.price, s.marketCap);
      if (s.mark.kind === "letter") out.push(s.mark.letter);
    }
    out.push(facts.multiple, facts.impliedPrice, facts.source, facts.url);
  }
  return out;
}

describe("the share card's font subset", () => {
  for (const [face, base64] of Object.entries(FACES)) {
    it(`covers every character the card can print (${face})`, () => {
      const covered = coveredCodepoints(base64);
      const missing = new Set<string>();
      for (const s of everyCardString()) {
        for (const ch of s) {
          if (ch === " ") continue;
          if (!covered.has(ch.codePointAt(0)!)) missing.add(ch);
        }
      }
      expect([...missing], "add these to CHARS in brand/subset-og-fonts.py and re-run it").toEqual(
        [],
      );
    });
  }

  it("stays small enough to sit in a function bundle", () => {
    // The whole face converts to ~270 KB. If a subset ever approaches that, the character
    // set has been widened to everything and the reason for subsetting is gone — and this
    // one ships inside the JS bundle, where the cost is paid on every cold start.
    for (const [face, base64] of Object.entries(FACES)) {
      const bytes = Buffer.from(base64, "base64").byteLength;
      expect(bytes, `${face} is ${Math.round(bytes / 1024)} KB`).toBeLessThan(40_000);
    }
  });

  it("is valid TTF, not a woff2 that satori would refuse", () => {
    // The subsetter's `--flavor=` is what strips the woff2 wrapper, and an empty string is
    // easy to lose in an edit. A woff2 begins "wOF2"; a TTF begins with 0x00010000.
    for (const [face, base64] of Object.entries(FACES)) {
      const head = Buffer.from(base64, "base64").subarray(0, 4);
      expect(head.toString("ascii"), `${face} is still woff2 — check --flavor=`).not.toBe("wOF2");
      expect([...head], `${face} is not a TTF`).toEqual([0, 1, 0, 0]);
    }
  });
});
