import type { EvalCase } from "./types";

/**
 * A value threshold over a trailing window. `/cross-chain`'s value chips send `min` and the
 * aggregate applies it in SQL, so "how many crossings above $10k in the last 46 days" is
 * answerable; saying the tool cannot aggregate by threshold is false about this explorer.
 *
 * The forbids also pin three answer-shape defects: deliberation published after the tool calls
 * ("Let me be precise about what I can and cannot answer here"), describing the agent's own tooling
 * to a reader who cannot act on its limits, and handing the work back ("I'd have to page through
 * all 749").
 */
export const CROSSCHAIN_THRESHOLD: EvalCase[] = [
  {
    id: "crosschain-value-threshold",
    category: "insights",
    world: "fixture",
    // The question kept verbatim, spelling and all: a case is a regression pin.
    question:
      "in the last 46 days, how many cross chain txns from bitcoin to zcash worth more than $10k?",
    mustCall: ["crosschain"],
    /*
     * 46 days back from the fixture clock is 2026-06-18, which takes in June's $4,000 crossing —
     * and the threshold drops it. One crossing clears, at 9,000 ZEC; the July crossing the venue
     * never priced is excluded rather than assumed to clear, so the count is a floor and the answer
     * must say why.
     */
    mustContain: [
      /9,?000/,
      /unpriced|never priced|not priced|no (?:published )?price|unknown price|without a price|no venue priced|venue (?:actually )?priced/i,
    ],
    mustNotContain: [
      // The unfiltered July total — what an answer that dropped the threshold reports.
      /12,000/,
      // The refusal, in two shapes.
      /(?:does|doesn['’]t|do not|don['’]t) (?:not )?(?:aggregate|filter|break) [^.]{0,40}(?:threshold|dollar|value)/i,
      /\bI (?:do not|don['’]t) have (?:a|the|that) count\b/i,
      // Deliberation published as the answer. "Let me" is in the prompt's own list; the second
      // pattern is the shape a model reaches for when explaining its position before stating it.
      /\bLet me\b/i,
      /\bI can and cannot\b/i,
      // The agent's own plumbing, described to somebody who cannot act on it.
      /\bthe (?:transfers |crosschain |cross-chain )?tool\b/i,
      /\bmy tools?\b/i,
      /returns? (?:at most|only) \d+/i,
      // The work handed back: paging a list by hand is what the count replaces.
      /(?:page|scroll|go) through (?:all )?(?:the )?\d/i,
    ],
  },
  {
    id: "crosschain-threshold-transfers",
    category: "insights",
    world: "fixture",
    // The other mode: a ranked list carries no `applied` echo, so the threshold is checked against
    // the rows' own swap-time dollars.
    question: "show me the cross-chain crossings worth more than $100,000",
    mustCall: ["crosschain"],
    // Only the 50,000 ZEC / $200,000 ETH leg clears.
    mustContain: [/50,000/],
    mustNotContain: [
      // The $36,000 Bitcoin crossing is below the threshold and must not be listed.
      /36,000/,
      /\bLet me\b/i,
    ],
  },
];
