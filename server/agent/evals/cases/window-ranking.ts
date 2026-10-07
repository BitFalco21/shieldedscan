import { ANSWERS_THE_QUANTITY_ASKED, STATES_A_TIE_RATHER_THAN_A_WINNER } from "../rubrics";
import type { EvalCase } from "./types";

/**
 * Ranking a period — superlative questions. Without `sort`, "which day had the most transactions"
 * could only be answered by reading a series capped at its 90 newest points. Routing is graded
 * mechanically; whether a tie is reported rather than resolved is a wording, and it is the failure
 * a ranking invites.
 */
export const WINDOW_RANKING: EvalCase[] = [
  {
    id: "activity-busiest-day",
    category: "insights",
    world: "fixture",
    question: "which day had the most transactions in July 2026?",
    mustCall: ["chain_activity"],
    // The fixture's five days run 9,000 / 6,000 / 5,000 / 3,000 / 2,000, so the busiest is unique —
    // and 9,000 is not the first bucket in date order, so an answer that read the series without
    // ranking lands on 6,000 and fails.
    mustContain: [/9,?000/],
    mustNotContain: [
      // The refusal, false now that `sort` exists.
      /I (?:don['’]t|do not) have (?:that|a|the) (?:figure|number|data)/i,
      /\b(?:not|isn['’]t) (?:something|a figure) (?:this explorer|we) (?:measures?|computes?)/i,
    ],
  },
  {
    id: "activity-quietest-day",
    category: "insights",
    world: "fixture",
    /*
     * The other direction, a separate parameter rather than a reading of the same list: ranking
     * highest and taking the last row would be right only when the window fits inside the display
     * cap. 2,000 is the fixture's floor.
     */
    question: "what was the quietest day for transactions in July 2026?",
    mustCall: ["chain_activity"],
    mustContain: [/2,?000/],
  },
  {
    id: "activity-fee-day-tie",
    category: "insights",
    world: "fixture",
    /*
     * Two days tie at the top for fees, so there is no single answer. Judged because a correct
     * answer names both days, so no forbid on a date can separate it from an answer naming one.
     */
    question: "which day paid the most in fees in July 2026?",
    mustCall: ["chain_activity"],
    mustSatisfy: [STATES_A_TIE_RATHER_THAN_A_WINNER],
  },
  {
    id: "activity-shielding-count-is-not-a-volume",
    category: "insights",
    world: "fixture",
    /*
     * The wrong quantity entirely: a ZEC volume given where a count of shielding transactions was
     * asked. The fixture's shielding peak is the fourth day (900) while the busiest day for
     * transactions, fully shielded transactions and unshielding is the second, so reaching for a
     * neighbouring column names a different day and fails.
     */
    question: "which day had the most shielding transactions in July 2026?",
    mustCall: ["chain_activity"],
    mustContain: [/\b900\b/],
    mustNotContain: [
      // The columns one word away. 1,295 is that window's largest unshielding day, 1,000 its
      // largest fully shielded day.
      /1,?295/,
      /1,?000\s+(?:fully\s+)?shielding/i,
      // Blaming Zcash for a rollup of ours: `tx.direction` is stored and fully backfilled, so the
      // chain records this — same forbid and reason as `insights-pool-migration-other-pools`.
      /chain (?:does not|doesn['’]t) record/i,
      /not recorded on[- ]?chain/i,
      // And the refusal itself, which is false: this figure is computed.
      /(?:does|do) not compute|(?:isn['’]t|is not) (?:a figure|something) (?:this explorer|we)/i,
    ],
    mustSatisfy: [ANSWERS_THE_QUANTITY_ASKED],
  },
];
