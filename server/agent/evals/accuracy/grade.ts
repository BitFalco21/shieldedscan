import type { AccuracyCase, Grade, TruthRow, TruthValue } from "./types";

/**
 * Grading one answer against one truth row. A pure function over strings, so a matcher change can
 * re-grade an old run without asking the model again, and every rule here is unit-tested.
 *
 * The rule, from the review of the first design: an answer carries many figures (context, other
 * pools, a block height, a floor), so a figure counts only when it is the nearest one of the case's
 * unit to the case's anchor, inside the same sentence, list item or table row. A figure that matches
 * one of the truth row's distractor columns names the mistake (the wrong window, the other
 * direction); one a digit away names a misquote.
 */

/** A figure further than this from its anchor is a different statement. */
const MAX_ANCHOR_DISTANCE = 120;

const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?";
const MONTH_INDEX: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

/** Spans that look numeric and are not figures: identifiers, dates, times. */
const NOT_FIGURES: RegExp[] = [
  /\b[0-9a-f]{16,}\b/gi,
  /\b(?:t1|t3|tm|zs1|u1|ztestsapling1|utest1)[0-9a-z]{6,}(?:…[0-9a-z]+)?/gi,
  /\b\d{4}-\d{2}-\d{2}(?:[t ]\d{2}:\d{2}(?::\d{2})?z?)?/gi,
  new RegExp(`\\b${MONTH} \\d{1,2}(?:st|nd|rd|th)?,? \\d{4}\\b`, "gi"),
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)? ${MONTH},? \\d{4}\\b`, "gi"),
  new RegExp(`\\b${MONTH} \\d{4}\\b`, "gi"),
  /\b\d{1,2}:\d{2}(?::\d{2})?\b/g,
  // Network upgrades and software versions: NU6.3, v1.8.2.
  /\bNU\d+(?:\.\d+)?\b/gi,
  /\bv?\d+\.\d+\.\d+\b/g,
];

/** The answer says the figure is not to be had, in any of the ways Zeno puts it. */
const DECLINE =
  /\b(?:not (?:available|measured|published|computed|recorded|public|knowable|stated|visible)|unavailable|unmeasured|unknown|can(?:no|')t (?:say|tell|state|see|be (?:seen|read|known))|isn't (?:public|recorded|visible|something)|no (?:figure|record|way to)|private|encrypted|hidden by design|does not record|doesn't record)\b/i;

/** Blank a span, keeping offsets so distances still mean characters of the answer. */
const blank = (s: string) => " ".repeat(s.length);

function masked(text: string, keepDates: boolean): string {
  let out = text;
  for (const re of NOT_FIGURES) {
    if (keepDates && re.source.includes("\\d{4}")) continue;
    out = out.replace(re, blank);
  }
  return out;
}

/** Sentences, list items and table rows: a figure belongs to the statement it sits in. */
export function segmentsOf(answer: string): string[] {
  return answer
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+(?=[A-Z0-9*`(])/))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

type TokenKind = "plain" | "zec" | "zat" | "pct" | "approx";

export interface Token {
  kind: TokenKind;
  /** The digits as written, grouping removed. */
  text: string;
  value: number;
  decimals: number;
  start: number;
  end: number;
}

const NUMBER =
  /(\$\s?)?(-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(\s*(?:%|ZEC\b|TAZ\b|zatoshis?\b|zats?\b|million\b|billion\b|thousand\b|[kMB]\b))?/gi;

/** Small counts are often written as words ("Three."). */
const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

/** Every figure in a segment, with what it is written in. Money in dollars is not a figure here. */
export function tokensOf(segment: string, skip: ReadonlySet<string>): Token[] {
  const tokens: Token[] = [];
  for (const m of segment.matchAll(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/gi)) {
    const value = NUMBER_WORDS[m[1]!.toLowerCase()]!;
    tokens.push({
      kind: "plain",
      text: String(value),
      value,
      decimals: 0,
      start: m.index!,
      end: m.index! + m[0].length,
    });
  }
  for (const m of segment.matchAll(NUMBER)) {
    if (m[1]) continue;
    const raw = m[2]!;
    const text = raw.replace(/,/g, "");
    const suffix = (m[3] ?? "").trim().toLowerCase();
    const decimals = text.includes(".") ? text.split(".")[1]!.length : 0;
    const value = Number(text);
    if (!Number.isFinite(value)) continue;
    let kind: TokenKind = "plain";
    if (suffix === "%") kind = "pct";
    else if (suffix === "zec" || suffix === "taz") kind = "zec";
    else if (suffix.startsWith("zat")) kind = "zat";
    else if (suffix !== "") kind = "approx";
    if (kind === "plain") {
      // A bare year, or a number the question itself carried (a height, a pool count), is context.
      if (!raw.includes(",") && decimals === 0 && value >= 2015 && value <= 2035) continue;
      if (skip.has(text)) continue;
    }
    const start = m.index! + (m[1]?.length ?? 0);
    tokens.push({ kind, text, value, decimals, start, end: start + raw.length });
  }
  return tokens;
}

/** Days written in a segment, as `YYYY-MM-DD`. */
export function daysOf(segment: string): { day: string; start: number; end: number }[] {
  const out: { day: string; start: number; end: number }[] = [];
  const pad = (n: number) => String(n).padStart(2, "0");
  const push = (y: number, mo: number, d: number, start: number, end: number) => {
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31)
      out.push({ day: `${y}-${pad(mo)}-${pad(d)}`, start, end });
  };
  for (const m of segment.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    push(Number(m[1]), Number(m[2]), Number(m[3]), m.index!, m.index! + m[0].length);
  }
  const monthOf = (s: string) => MONTH_INDEX[s.slice(0, 3).toLowerCase()] ?? 0;
  for (const m of segment.matchAll(
    new RegExp(`\\b(${MONTH}) (\\d{1,2})(?:st|nd|rd|th)?,? (\\d{4})\\b`, "gi"),
  )) {
    push(Number(m[3]), monthOf(m[1]!), Number(m[2]), m.index!, m.index! + m[0].length);
  }
  for (const m of segment.matchAll(
    new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)? (${MONTH}),? (\\d{4})\\b`, "gi"),
  )) {
    push(Number(m[3]), monthOf(m[2]!), Number(m[1]), m.index!, m.index! + m[0].length);
  }
  return out;
}

const significantDigits = (text: string) => text.replace(/^-?0*\.?0*/, "").replace(".", "").length;

/** Whether a written figure states the truth, by the unit's rule. */
export function matches(
  unit: AccuracyCase["expect"]["unit"],
  token: Token,
  truth: TruthValue,
): boolean {
  if (typeof truth !== "number") return false;
  switch (unit) {
    case "count":
      return token.kind === "plain" && token.decimals === 0 && token.value === truth;
    case "zec": {
      if (token.kind === "zat") return token.decimals === 0 && token.value === truth;
      if (token.kind !== "zec") return false;
      const zec = truth / 1e8;
      // Exact at the decimals written, or rounded or cut there with at least four significant
      // digits. A relative tolerance would pass a transposed digit.
      if (Math.abs(token.value * 1e8 - truth) < 0.5) return true;
      if (significantDigits(token.text) < 4) return false;
      const scale = 10 ** token.decimals;
      const rounded = Math.round(zec * scale) / scale;
      const cut = Math.trunc(zec * scale) / scale;
      return (
        Math.abs(token.value - rounded) < 0.5 / scale || Math.abs(token.value - cut) < 0.5 / scale
      );
    }
    case "pct":
      return token.kind === "pct" && Math.abs(token.value - truth) <= 10 ** -token.decimals + 1e-9;
    default:
      return false;
  }
}

/** The kinds of written figure a unit reads. */
const READS: Record<string, readonly TokenKind[]> = {
  count: ["plain"],
  zec: ["zec", "zat"],
  pct: ["pct"],
  unmeasured: ["zec", "zat"],
};

/** One edit apart, or a factor of ten: the shapes a transcription slip takes. */
export function isMisquote(written: string, truth: number): boolean {
  const a = written.replace(/[^\d]/g, "");
  const b = String(Math.round(truth)).replace(/[^\d]/g, "");
  if (a === b) return false;
  // A slip needs digits to slip in: any two one-digit figures are one edit apart, and so are
  // 0.0001 and 0.00015 ZEC, which are two different medians, not one misquoted.
  if (b.replace(/0+$/, "").length < 3) return false;
  const ratio = Number(written) / truth;
  if (Math.abs(ratio - 10) < 1e-9 || Math.abs(ratio - 0.1) < 1e-9) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  // Levenshtein distance of exactly one.
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    edits++;
    if (edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) === 1;
}

/** The figures nearest each anchor match, per segment. */
function anchored<T extends { start: number; end: number }>(
  segment: string,
  anchor: RegExp,
  items: T[],
): T[] {
  const found: T[] = [];
  const re = new RegExp(
    anchor.source,
    anchor.flags.includes("g") ? anchor.flags : `${anchor.flags}g`,
  );
  for (const m of segment.matchAll(re)) {
    const a0 = m.index!;
    const a1 = a0 + m[0].length;
    let best: T | null = null;
    let bestDistance = Infinity;
    for (const item of items) {
      const distance = item.start >= a1 ? item.start - a1 : item.end <= a0 ? a0 - item.end : 0;
      if (distance < bestDistance) {
        best = item;
        bestDistance = distance;
      }
    }
    if (best !== null && bestDistance <= MAX_ANCHOR_DISTANCE && !found.includes(best))
      found.push(best);
  }
  return found;
}

export function gradeAnswer(
  testCase: Pick<AccuracyCase, "expect" | "question">,
  truth: TruthRow,
  answer: string,
): Grade {
  const { unit, column, anchor, distractors = [] } = testCase.expect;
  const expected = truth[column] ?? null;
  const skip = new Set(tokensOf(masked(testCase.question, false), new Set()).map((t) => t.text));
  const segments = segmentsOf(answer);
  const declined = DECLINE.test(answer);

  if (unit === "day") {
    const candidates = segments.flatMap((s) => anchored(s, anchor, daysOf(s))).map((d) => d.day);
    if (candidates.length === 0) {
      return { verdict: declined ? "DECLINED" : "NO_FIGURE", detail: "no anchored day" };
    }
    const hit = candidates.includes(String(expected));
    const others = candidates.filter((d) => d !== expected);
    if (hit && others.length === 0) return { verdict: "CORRECT", detail: String(expected) };
    if (hit) return { verdict: "MIXED", detail: `also ${others.join(", ")}` };
    const named = distractors.filter((c) => others.includes(String(truth[c])));
    return {
      verdict: "WRONG",
      detail: `said ${others.join(", ")}, truth ${String(expected)}${named.length ? `; equals ${named.join(", ")}` : ""}`,
    };
  }

  const reads = READS[unit]!;
  const candidates: Token[] = [];
  const approx: Token[] = [];
  for (const s of segments) {
    const tokens = tokensOf(masked(s, false), skip);
    const readable = tokens.filter(
      (t) => reads.includes(t.kind) && (unit !== "count" || t.decimals === 0),
    );
    const near = anchored(s, anchor, readable);
    // An amount in a sentence about the fee is the fee, which a shielded transaction does publish.
    candidates.push(...(unit === "unmeasured" ? near.filter(() => !/\bfee/i.test(s)) : near));
    approx.push(
      ...anchored(
        s,
        anchor,
        tokens.filter((t) => t.kind === "approx"),
      ),
    );
  }

  if (unit === "unmeasured") {
    if (candidates.length > 0) {
      return { verdict: "WRONG", detail: `stated ${candidates.map((t) => t.text).join(", ")}` };
    }
    return declined
      ? { verdict: "CORRECT", detail: "declined" }
      : { verdict: "NO_FIGURE", detail: "neither a figure nor a decline" };
  }

  if (candidates.length === 0) {
    if (approx.length > 0)
      return { verdict: "APPROX", detail: approx.map((t) => t.text).join(", ") };
    return { verdict: declined ? "DECLINED" : "NO_FIGURE", detail: "no anchored figure" };
  }
  const hits = candidates.filter((t) => matches(unit, t, expected));
  const conflicts = candidates.filter((t) => !matches(unit, t, expected));
  const asTruthUnit = (t: Token) => (t.kind === "zec" ? t.value * 1e8 : t.value);
  const slip = (t: Token) =>
    typeof expected === "number" && isMisquote(String(Math.round(asTruthUnit(t))), expected);
  if (hits.length > 0) {
    // Beside the right figure, a different one is usually context (the other direction, a rate, a
    // display cap). Only a figure a digit away from the truth competes with it: the same quantity
    // stated twice, once wrongly.
    const competing = conflicts.filter(slip);
    if (competing.length > 0) {
      return { verdict: "MIXED", detail: `also ${competing.map((t) => t.text).join(", ")}` };
    }
    return { verdict: "CORRECT", detail: hits.map((t) => t.text).join(", ") };
  }
  const labels = conflicts.map((t) => {
    const equals = distractors.filter((c) => matches(unit, t, truth[c] ?? null));
    if (equals.length > 0) return `${t.text} = ${equals.join("/")}`;
    return slip(t) ? `${t.text} misquote` : t.text;
  });
  return { verdict: "WRONG", detail: `said ${labels.join(", ")}; truth ${String(expected)}` };
}
