import type { ToolName } from "../../tools/names";

/**
 * Zeno's accuracy on specific figures, measured against the chain index itself. Each case asks one
 * question whose answer a read-only query computes at run time, so the expected value never goes
 * stale and a regression in the data, the routing or the transcription shows up as a wrong figure.
 */

/** What the answer's figure is written in. A ZEC truth is stored in zatoshis. */
export type AccuracyUnit = "count" | "zec" | "pct" | "day" | "unmeasured";

/** How a case's truth relates to what Zeno reads. Reported separately: they measure different things. */
export type Independence =
  /** Recomputed from base rows (`block`, `tx`), not the rollup Zeno's tool reads. */
  | "base"
  /** The same stored rollup Zeno reads, because recomputing it would be too slow or differ by design. */
  | "same-rollup";

/** One truth value: a number (a zatoshi amount for `zec`), a `YYYY-MM-DD` day, or no value. */
export type TruthValue = number | string | null;
export type TruthRow = Record<string, TruthValue>;

export interface AccuracyCase {
  id: string;
  /** For the report's table. */
  area:
    "blocks" | "transactions" | "pools" | "shielding" | "fees" | "supply" | "mining" | "records";
  question: string;
  /** The same question as a visitor might type it. Graded as its own run. */
  variants?: string[];
  independence: Independence;
  truth: {
    /**
     * One SELECT over `opendata.*` returning one row. `$n` parameters come from `params`; anything
     * that is not SQL (a pool's reviewed addresses) is passed in, never spliced into the text.
     */
    sql: string;
    params?: () => unknown[];
    /** Turns the row into the answer when the figure needs the site's own rules (a pool's share). */
    derive?: (row: TruthRow) => TruthRow;
  };
  expect: {
    unit: AccuracyUnit;
    /** The truth column holding the answer. */
    column: string;
    /**
     * Where in the answer the figure must sit: a candidate is the nearest figure of the unit to a
     * match of this pattern, in the same sentence, list item or table row.
     */
    anchor: RegExp;
    /** Truth columns a wrong answer is likely to state instead (a different window, the other direction). */
    distractors?: string[];
    /** For `unmeasured`: truth columns holding figures the answer may state (a fee, a value balance). */
    allowed?: string[];
    /** Words that satisfy `anchor`, for the tests that build answers around a case. */
    label: string;
  };
  /** The calls a well-routed answer makes, dispatched without a model to check the figure reaches it. */
  route?: { name: ToolName; args: Record<string, unknown> }[];
}

export type Verdict =
  /** The answer's first anchored figure is the truth, and no later one is a near-copy of it. */
  | "CORRECT"
  /** No anchored figure is the truth. */
  | "WRONG"
  /** The truth appears, but behind a different headline, or beside a near-copy of itself. */
  | "MIXED"
  /** Only a rounded form ("about 1.4 million"). */
  | "APPROX"
  /** The answer says the figure is not available. Correct only for an `unmeasured` case. */
  | "DECLINED"
  /** No figure of the unit beside the anchor, and no decline. */
  | "NO_FIGURE";

export interface Grade {
  verdict: Verdict;
  /** What was compared, for the report: the candidates found and what a wrong one equals. */
  detail: string;
}
