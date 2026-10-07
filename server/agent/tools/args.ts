import { DAY_MS, parseUtcDayStart, utcDayFromMs } from "@/domain";

/**
 * Typed reads of a tool call's arguments, including the period a windowed tool answers for.
 */

/**
 * Typed reads of one tool call's arguments. A model often sends a number or a boolean as a string,
 * so each reader accepts that form; `raw` stays available for presence checks and the shapes these
 * do not cover.
 */
export interface ToolArgs {
  readonly raw: Record<string, unknown>;
  /** A non-empty string, trimmed. */
  str(key: string): string | null;
  /**
   * An integer. A fractional or non-numeric value is rejected rather than floored: "3.5 days" is a
   * misunderstanding to hand back.
   */
  int(key: string): number | null;
  /**
   * Any finite number, where `int` would reject a legitimate fraction: a dollar threshold of 12.50
   * is a real question. Range is checked at the call site, where the units are known.
   */
  num(key: string): number | null;
  /**
   * An optional boolean. Anything unrecognised is false rather than an error: a flag only decides
   * whether an extra payload rides along, so a misread one costs one unfetched list, where a
   * rejected call would cost the whole lookup.
   */
  flag(key: string): boolean;
}

export function toolArgs(raw: Record<string, unknown>): ToolArgs {
  const asNumber = (v: unknown): number =>
    typeof v === "number" ? v : typeof v === "string" ? Number(v.trim()) : NaN;
  return {
    raw,
    str: (key) => {
      const v = raw[key];
      return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
    },
    int: (key) => {
      const n = asNumber(raw[key]);
      return Number.isInteger(n) ? n : null;
    },
    num: (key) => {
      const n = asNumber(raw[key]);
      return Number.isFinite(n) ? n : null;
    },
    flag: (key) => {
      const v = raw[key];
      return v === true || (typeof v === "string" && v.trim().toLowerCase() === "true");
    },
  };
}

/**
 * The period a windowed mode answers for, or the error the model should see: absolute UTC days
 * (`from` inclusive, `to` exclusive), or a trailing `lastDays` resolved from the turn's clock.
 */
export function windowDays(
  args: ToolArgs,
  nowMs: number,
): Record<"from" | "to", string | null> | string {
  const { str, int } = args;
  const days: Record<"from" | "to", string | null> = { from: null, to: null };
  for (const key of ["from", "to"] as const) {
    const raw = str(key);
    if (raw === null) continue;
    // A round-trip, not a shape check: `2026-02-31` is well-formed and `Date.parse` rolls it into March.
    if (parseUtcDayStart(raw) === null) {
      return `${key} is not a real calendar day: ${raw}`;
    }
    days[key] = raw;
  }
  if (days.from !== null && days.to !== null && days.to <= days.from) {
    return `to must be after from — and note it is EXCLUSIVE, so the whole of a month ends on the 1st of the next one`;
  }
  // The trailing window, resolved from the clock for the reason `trailingWindow` gives. Mutually
  // exclusive with the absolute edges, as on `crosschain`.
  if (args.raw.lastDays !== undefined) {
    const lastDays = int("lastDays");
    if (lastDays === null || lastDays < 1 || lastDays > MAX_LAST_DAYS) {
      return `lastDays must be a whole number of days between 1 and ${MAX_LAST_DAYS}`;
    }
    if (days.from !== null || days.to !== null) {
      return `use lastDays for a trailing window OR from/to for an absolute one, never both — they would name two different periods`;
    }
    const window = trailingWindow(nowMs, lastDays);
    days.from = window.from;
    days.to = window.to;
  }
  return days;
}

/** The widest trailing window a question may name, in days — ~5 years, past which name the dates. */
const MAX_LAST_DAYS = 2_000;

/**
 * A trailing window of `lastDays` days, as the two absolute UTC days every windowed route takes.
 *
 * The per-turn calendar spells out only a few windows and the prompt tells the model to copy one
 * rather than derive a date, which leaves every other length ("the last 46 days") without an honest
 * route. So the window is resolved here, from the turn's clock, and handed over finished.
 *
 * The end is exclusive and is today, the calendar's own convention: today's partial day is left out
 * rather than counted as a whole one.
 */
function trailingWindow(nowMs: number, lastDays: number): { from: string; to: string } {
  return { from: utcDayFromMs(nowMs - lastDays * DAY_MS), to: utcDayFromMs(nowMs) };
}
