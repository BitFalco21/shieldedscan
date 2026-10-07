/**
 * The agent's calculator: a hand-rolled arithmetic evaluator for the `calculate` tool.
 *
 * Model arithmetic done "in the head" is unauditable. A tool call is the opposite: the expression
 * is recorded in the transcript and rendered in the thinking trail, and evaluation is
 * deterministic. What remains is operand-choice risk (the wrong two numbers, or two bases mixed),
 * which is as visible as the expression and is what the prompt rules and the eval corpus test.
 *
 * Headline figures stay pre-computed in their payloads and the prompt says to prefer those: a
 * headline computed two ways on one site will eventually disagree with itself. The calculator is
 * for the long tail of simple derivations.
 *
 * No `eval`, no `Function`, no dependency. This is also the security property: the grammar cannot
 * express an identifier, a call, or anything but numbers and five operators, so no injected text
 * can pass through it and no sandbox is being trusted.
 *
 * Grammar (recursive descent, standard precedence):
 *
 *   expression := term (('+' | '-') term)*
 *   term       := factor (('*' | '/') factor)*
 *   factor     := '-' factor | '(' expression ')' | number
 *   number     := digits with optional ',' or '_' group separators and one '.' decimal part
 *
 * Commas are strictly thousands separators ("13,135.34", the form this site's payloads use), never
 * a decimal mark. Results are float64: integers are exact to 2^53 (MAX_MONEY is 2.1e15, so every
 * zatoshi amount fits), and division is as exact as binary floating point allows.
 */

/** A successfully evaluated expression, or the reason it was refused. */
export type Evaluation = { ok: true; value: number } | { ok: false; error: string };

export const MAX_EXPRESSION_LENGTH = 200;

const fail = (error: string): Evaluation => ({ ok: false, error });

export function evaluateExpression(raw: string): Evaluation {
  if (raw.length > MAX_EXPRESSION_LENGTH) {
    return fail(`expression is longer than ${MAX_EXPRESSION_LENGTH} characters`);
  }
  const tokens = tokenize(raw);
  if (typeof tokens === "string") return fail(tokens);
  if (tokens.length === 0) return fail("expression is empty");

  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function expression(): number | string {
    let left = term();
    if (typeof left === "string") return left;
    while (peek() === "+" || peek() === "-") {
      const op = next();
      const right = term();
      if (typeof right === "string") return right;
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }

  function term(): number | string {
    let left = factor();
    if (typeof left === "string") return left;
    while (peek() === "*" || peek() === "/") {
      const op = next();
      const right = factor();
      if (typeof right === "string") return right;
      if (op === "/") {
        if (right === 0) return "division by zero";
        left = left / right;
      } else {
        left = left * right;
      }
    }
    return left;
  }

  function factor(): number | string {
    const token = peek();
    if (token === undefined) return "expression ends where a number was expected";
    if (token === "-") {
      next();
      const inner = factor();
      return typeof inner === "string" ? inner : -inner;
    }
    if (token === "(") {
      next();
      const inner = expression();
      if (typeof inner === "string") return inner;
      if (next() !== ")") return "unbalanced parentheses";
      return inner;
    }
    if (typeof token === "number") {
      next();
      return token;
    }
    return `unexpected '${token}' where a number was expected`;
  }

  const value = expression();
  if (typeof value === "string") return fail(value);
  if (pos !== tokens.length)
    return fail(`unexpected '${String(tokens[pos])}' after the expression`);
  if (!Number.isFinite(value)) return fail("the result is not a finite number");
  // Exact only up to 2^53; past it a float rounds silently and would be printed as a confidently
  // exact integer. No Zcash figure is anywhere near this, so the refusal costs no real question.
  if (Math.abs(value) > Number.MAX_SAFE_INTEGER)
    return fail("the result is too large for this calculator to state exactly (above 9e15)");
  return { ok: true, value };
}

type Token = number | "+" | "-" | "*" | "/" | "(" | ")";

/** Tokens, or an error message. The only text that survives is numbers and five operators. */
function tokenize(raw: string): Token[] | string {
  const tokens: Token[] = [];
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i]!;
    if (ch === " " || ch === "\t" || ch === "\n") {
      i += 1;
      continue;
    }
    if (ch === "+" || ch === "-" || ch === "*" || ch === "/" || ch === "(" || ch === ")") {
      tokens.push(ch);
      i += 1;
      continue;
    }
    if ((ch >= "0" && ch <= "9") || ch === ".") {
      let j = i;
      while (j < raw.length) {
        const c = raw[j]!;
        if ((c >= "0" && c <= "9") || c === "." || c === "," || c === "_") j += 1;
        else break;
      }
      const literal = raw.slice(i, j).replace(/[,_]/g, "");
      if (literal === "." || (literal.match(/\./g) ?? []).length > 1) {
        return `'${raw.slice(i, j)}' is not a number`;
      }
      const value = Number(literal);
      if (!Number.isFinite(value)) return `'${raw.slice(i, j)}' is not a number`;
      tokens.push(value);
      i = j;
      continue;
    }
    return `'${ch}' is not part of an arithmetic expression — only numbers, + - * / and parentheses are accepted`;
  }
  return tokens;
}

/**
 * The result as a string the model can quote: grouped, up to 8 fraction digits (the zatoshi
 * grain), and never more precision than binary floating point honestly carries.
 */
export function formatCalculationResult(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 8 });
}
