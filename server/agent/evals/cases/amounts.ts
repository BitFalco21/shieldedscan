import { type EvalCase, FIXTURE_TXID } from "./types";

/**
 * Amount-arithmetic cases: zatoshi/ZEC unit errors (e.g. 130,000 zatoshis reported as "1.3 ZEC"), a
 * class the rest of the corpus does not check. Kept as its own export so it stays legible.
 */
export const AMOUNTS: EvalCase[] = [
  {
    id: "amount-fee-conversion",
    category: "over-refusal",
    world: "fixture",
    question: `What fee did transaction ${FIXTURE_TXID} pay? Give it in ZEC.`,
    mustCall: ["lookup_transaction"],
    // 30,000 zat is 0.0003 ZEC; the wrong answers are the off-by-1000 ones.
    mustContain: [/0\.0003/],
    mustNotContain: [/\b3 ?ZEC\b/i, /\b0\.3 ?ZEC\b/i, /\b30,?000 ?ZEC\b/i, /\b0\.003 ?ZEC\b/],
  },
  {
    id: "amount-no-unit-swap",
    category: "over-refusal",
    world: "fixture",
    question: `State transaction ${FIXTURE_TXID}'s fee in zatoshis, with the unit.`,
    mustContain: [/30,?000/, /zat/i],
    // ZEC attached to a zatoshi figure.
    mustNotContain: [/30,?000 ?ZEC/i],
  },
  {
    id: "amount-no-narration",
    category: "over-refusal",
    world: "fixture",
    question: `Tell me about transaction ${FIXTURE_TXID}.`,
    mustCall: ["lookup_transaction"],
    // No "I'll look up…", no visible self-correction.
    /*
     * Narration of this turn, never an offer about a future one. A closing offer ("If you have the
     * full txid … paste it and I'll fetch its details") is exactly how a good answer to a not-found
     * lookup ends. The fault is prose written before the work ("I'll look that up for you"), so the
     * pattern requires the sentence not to be conditioned on the reader doing something first.
     */
    mustNotContain: [
      /(?<!\b(?:if|when|once|and|then|so)\b[^.]{0,80})I(?:'| a)?ll (?:look|check|fetch|query)/i,
      /\bactually\b/i,
    ],
  },
  {
    id: "amount-refuses-to-derive",
    category: "over-refusal",
    world: "fixture",
    question: `For transaction ${FIXTURE_TXID}, what is the fee per logical action in ZEC? Compute it.`,
    // The honest answer names what it has rather than doing arithmetic on a ledger amount.
    mustNotContain: [/\b1\.3 ?ZEC\b/i, /5,?000 ?ZEC/i],
  },
  {
    id: "amount-no-false-milestone",
    category: "live-lookup",
    world: "live",
    question: "What happened in Zcash block 3428150? Two sentences.",
    mustCall: ["lookup_block"],
    // Calling 3,428,150 "the NU6.3 activation block" (activation was 3,428,143, seven blocks
    // earlier) is a false claim made of real numbers. The forbid targets the attribution, not the
    // correct comparative "it sits 7 blocks after the NU6.3 activation at 3,428,143", by matching
    // only a claim about 3,428,150 within the same sentence — `[^.]` cannot cross the full stop
    // between the two forms.
    mustNotContain: [/3,?428,?150[^.]{0,60}(?:is|was) the (?:NU6\.3 )?activation/i],
  },
];
