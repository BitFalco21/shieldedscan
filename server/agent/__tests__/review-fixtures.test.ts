import { describe, expect, it } from "vitest";
import { ALL_FIXTURES } from "../evals/review-fixtures";
import { ALL_RUBRICS } from "../evals/rubrics";

describe("the judge's validation set", () => {
  it("covers every rubric in BOTH directions", () => {
    // A rubric with only passing fixtures proves the judge is not too strict and says nothing about
    // the direction that matters, so every rubric needs a failing fixture too.
    for (const rubric of ALL_RUBRICS) {
      const mine = ALL_FIXTURES.filter((f) => f.rubric.id === rubric.id);
      expect(
        mine.some((f) => f.expect === "pass"),
        `${rubric.id} has no PASS fixture`,
      ).toBe(true);
      expect(
        mine.some((f) => f.expect === "fail"),
        `${rubric.id} has no FAIL fixture`,
      ).toBe(true);
    }
  });

  it("carries at least one observed fixture, not only invented ones", () => {
    // A constructed negative is our imagination of misbehaviour; real agent output is the only
    // evidence of what the agent actually does.
    expect(ALL_FIXTURES.some((f) => f.provenance === "observed")).toBe(true);
  });

  it("says why every fixture exists", () => {
    for (const f of ALL_FIXTURES) {
      expect(f.note.length, `fixture for ${f.rubric.id} has no note`).toBeGreaterThan(15);
      // The empty-answer fixture is exempt from the length floor, since emptiness is the property
      // it pins. Every other answer must be real prose.
      if (f.answer !== "") {
        expect(f.answer.length, `fixture for ${f.rubric.id} has no answer`).toBeGreaterThan(15);
      }
    }
  });

  it("pins an EMPTY answer as a failure of REFUSES, not a refusal", () => {
    // `run.ts` resets the collected text on every tool call, so a turn ending with no post-reset
    // text hands `""` to the judge, and some cases assert rubrics alone. `grade.ts` fails the case
    // before any judge call; this is the judge's own half of the same property.
    const empty = ALL_FIXTURES.filter((f) => f.answer.trim() === "");
    expect(empty).toHaveLength(1);
    expect(empty[0]?.expect).toBe("fail");
    expect(empty[0]?.rubric.id).toBe("refuses");
  });

  it("includes the answer that proved the old grader unsound", () => {
    const known = ALL_FIXTURES.find((f) => f.answer.includes("doesn't come back"));
    expect(known?.expect).toBe("fail");
    expect(known?.rubric.id).toBe("no-change-payment-inference");
  });

  it("distinguishes a nonexistent fee from a hidden one", () => {
    // A coinbase fee is nonexistent, not encrypted and not unmeasured. The negative fixture is an
    // answer calling it unknown: claiming ignorance of something never in doubt is the mirror of
    // fabricating it.
    const mine = ALL_FIXTURES.filter((f) => f.rubric.id === "states-fee-nonexistent");
    expect(mine).toHaveLength(2);
    expect(mine.find((f) => f.expect === "fail")?.answer).toMatch(/unknown/i);
  });
});
