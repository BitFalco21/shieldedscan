import { describe, expect, it } from "vitest";
import { evaluateExpression, formatCalculationResult, MAX_EXPRESSION_LENGTH } from "../calculator";

/**
 * The evaluator behind `calculate`. The rejection cases matter as much as the arithmetic: a grammar
 * admitting anything beyond numbers and five operators would turn a deterministic evaluator into a
 * text channel.
 */
describe("evaluateExpression", () => {
  const value = (expr: string): number => {
    const out = evaluateExpression(expr);
    if (!out.ok) throw new Error(`${expr} failed: ${out.error}`);
    return out.value;
  };
  const error = (expr: string): string => {
    const out = evaluateExpression(expr);
    if (out.ok) throw new Error(`${expr} unexpectedly evaluated to ${out.value}`);
    return out.error;
  };

  it("applies standard precedence and parentheses", () => {
    expect(value("2 + 3 * 4")).toBe(14);
    expect(value("(2 + 3) * 4")).toBe(20);
    expect(value("100 - 20 - 5")).toBe(75); // left-associative, not 85
    expect(value("100 / 10 / 2")).toBe(5);
    expect(value("((1 + 2) * (3 + 4))")).toBe(21);
  });

  it("handles unary minus, including nested and applied to parentheses", () => {
    expect(value("-5 + 3")).toBe(-2);
    expect(value("2 * -3")).toBe(-6);
    expect(value("-(2 + 3)")).toBe(-5);
    expect(value("--4")).toBe(4);
  });

  it("reads the payload's own number formats: commas and underscores as grouping", () => {
    expect(value("13,135.34847561 * 2")).toBeCloseTo(26_270.69695122, 6);
    expect(value("1_000_000 / 4")).toBe(250_000);
  });

  it("keeps zatoshi-scale integers exact", () => {
    // MAX_MONEY is 2.1e15 zat, inside float64's 2^53 exact-integer range.
    expect(value("2,100,000,000,000,000 - 1")).toBe(2_099_999_999_999_999);
  });

  it("refuses division by zero and non-finite results, never returning Infinity or NaN", () => {
    expect(error("1 / 0")).toMatch(/division by zero/);
    expect(error("1 / (2 - 2)")).toMatch(/division by zero/);
  });

  it("refuses anything that is not numbers and five operators — the security property", () => {
    expect(error("Math.max(1, 2)")).toMatch(/not part of an arithmetic expression/);
    expect(error("1 + x")).toMatch(/not part of an arithmetic expression/);
    expect(error("2 ** 3")).toMatch(/unexpected/);
    expect(error("1; 2")).toMatch(/not part of an arithmetic expression/);
    expect(error("$50 * 2")).toMatch(/not part of an arithmetic expression/);
  });

  it("refuses malformed expressions with a message the model can act on", () => {
    expect(error("")).toMatch(/empty/);
    expect(error("(1 + 2")).toMatch(/unbalanced parentheses/);
    expect(error("1 +")).toMatch(/ends where a number was expected/);
    expect(error("1 2")).toMatch(/after the expression/);
    expect(error("1..5 + 2")).toMatch(/is not a number/);
    expect(error(`1 + ${"9".repeat(MAX_EXPRESSION_LENGTH)}`)).toMatch(/longer than/);
  });
});

describe("exactness bound", () => {
  it("refuses a result past 2^53 instead of printing a rounded float as exact", () => {
    // Past 2^53 a float rounds silently, so an exact-looking product would be wrong. No Zcash
    // figure is near 9e15, so the refusal costs no real question.
    const r = evaluateExpression("99999999999999999999*99999999999999999999");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/exactly/);
    expect(evaluateExpression("2100000000000000*4").ok).toBe(true);
  });
});

describe("formatCalculationResult", () => {
  it("groups digits and caps at the zatoshi grain", () => {
    expect(formatCalculationResult(448_178.0895)).toBe("448,178.0895");
    expect(formatCalculationResult(1 / 3)).toBe("0.33333333");
    expect(formatCalculationResult(2_099_999_999_999_999)).toBe("2,099,999,999,999,999");
  });
});
