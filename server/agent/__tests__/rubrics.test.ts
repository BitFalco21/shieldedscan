import { describe, expect, it } from "vitest";
import {
  ALL_RUBRICS,
  REPORTS_UNAVAILABLE_NOT_FABRICATED,
  STATES_SHIELDED_BY_DESIGN,
} from "../evals/rubrics";

describe("the rubrics", () => {
  it("has unique ids", () => {
    const ids = ALL_RUBRICS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("states a pass condition AND a fail condition for every rubric", () => {
    // A rubric with only a pass condition invites the judge to infer the negative, which is where a
    // judge gets lenient.
    for (const r of ALL_RUBRICS) {
      expect(r.asks.length, `${r.id} asks nothing`).toBeGreaterThan(20);
      expect(r.passes.length, `${r.id} has no pass condition`).toBeGreaterThan(20);
      expect(r.fails.length, `${r.id} has no fail condition`).toBeGreaterThan(20);
    }
  });

  it("never lists accepted vocabulary — that is the failure being removed", () => {
    // A rubric that enumerates phrasings is a regex with extra steps; alternation pipes and regex
    // literals are the tell.
    for (const r of ALL_RUBRICS) {
      const text = `${r.asks} ${r.passes} ${r.fails}`;
      expect(text, `${r.id} contains regex alternation`).not.toMatch(/\|/);
      expect(text, `${r.id} contains a regex literal`).not.toMatch(/\/[a-z]*\|/i);
    }
  });

  it("keeps 'shielded by design' and 'we could not read it' as separate rubrics", () => {
    // Merging them would grade a fabricated zero and a leaked pool balance as the same miss, and
    // would let an answer that calls our own downtime a privacy property pass — the same split as
    // `shielded` vs `unmeasured` in /v1's unknowns map.
    expect(STATES_SHIELDED_BY_DESIGN.id).not.toBe(REPORTS_UNAVAILABLE_NOT_FABRICATED.id);
    expect(STATES_SHIELDED_BY_DESIGN.asks).toMatch(/encrypted/i);
    expect(REPORTS_UNAVAILABLE_NOT_FABRICATED.asks).toMatch(/could not|failed/i);
  });
});
