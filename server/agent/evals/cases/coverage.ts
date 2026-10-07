import { DOES_NOT_DELEGATE_ITS_OWN_WORK, REFUSES } from "../rubrics";
import type { EvalCase } from "./types";

/**
 * Coverage: whether the agent produces the right absence. A true decline and a false one read the
 * same to a reader and a grader, so these grade the decline itself — in two directions, because the
 * register can leave a real gap vague, or teach the agent to call our own unbuilt aggregate a
 * property of Zcash, the more persuasive failure on a privacy explorer.
 */
export const COVERAGE: EvalCase[] = [
  {
    id: "coverage-active-addresses",
    category: "over-refusal",
    world: "fixture",
    // The question as a visitor asks it, lowercase and all.
    question: "how many active transparent addresses in the last month?",
    /*
     * `chain_activity` 'transparent' counts distinct addresses exactly per calendar month and over
     * the trailing 30 days, so a decline here is a wrong refusal. "The last month" reads two ways
     * and both have an exact figure: July 2026 (61,000) or the trailing 30 days (58,000).
     */
    mustCall: ["chain_activity"],
    mustContain: [/58,?000|61,?000/],
    mustNotContain: [
      // July's daily counts summed: a distinct count added across days counts an address twice.
      /186,?465/,
      // False: transparent activity is public by construction.
      /(?:chain|protocol|zcash) (?:does not|doesn't|cannot|can't) (?:record|track|expose|reveal) (?:which |what )?(?:transparent )?address/i,
    ],
    // Judged on the half that outlives the decline: the figure is given, never handed back to the
    // reader to add up from daily counts.
    mustSatisfy: [DOES_NOT_DELEGATE_ITS_OWN_WORK],
  },
  {
    id: "activity-transparent-volume-month",
    category: "insights",
    world: "fixture",
    /*
     * Transparent volume and its senders for a whole month. The fixture's July pays 12,400,465 ZEC
     * to transparent outputs in transparent-only transactions and 279,000 in mixed ones (12,679,465
     * in all), and 30,000 distinct addresses sent. The forbid is the month's daily senders summed
     * (31 × 4,000) — the distinct-count trap again.
     */
    question:
      "how much ZEC was paid to transparent outputs in July 2026, and how many distinct addresses sent ZEC that month?",
    mustCall: ["chain_activity"],
    mustContain: [/12,?679,?465|12,?400,?465/, /30,?000/],
    mustNotContain: [/124,?000/],
  },
  {
    id: "coverage-does-not-over-decline",
    category: "over-refusal",
    world: "fixture",
    /*
     * The guard on the cure: a question the register does not mention and the tools answer. Passing
     * means the register is treated as evidence about the gaps it lists and nothing else; read as a
     * register of presences it would make anything unlisted look deliberately excluded.
     */
    question: "how many transactions were there in July, and how many of them were fully shielded?",
    mustCall: ["chain_activity"],
    mustNotSatisfy: [REFUSES],
  },
];
