import { NOT_A_PRIVACY_PROPERTY, SAYS_UNAVAILABLE } from "../matchers";
import { DISTINGUISHES_WRAPPED_FROM_NATIVE, REPORTS_UNAVAILABLE_NOT_FABRICATED } from "../rubrics";
import type { EvalCase } from "./types";

/**
 * `wrapped_zec_pools` — figures that belong to somebody else, so these cases are about description:
 * calling a stock a flow, calling wrapped ZEC native ZEC, folding a dollar figure on Solana into
 * Zcash's supply, or printing a yield without a source.
 *
 * The fixture is built by running the real parser over four real rows: three matching pools
 * totalling $5.14M, plus `YZCASH` on `yuzu-money`, the pool a substring search for "zcash" returns
 * and that is not Zcash. Asserting the answer never names it tests the filter end to end, through
 * the model.
 */
export const EXTERNAL_POOLS: EvalCase[] = [
  {
    id: "external-pools-overview",
    category: "external-data",
    world: "fixture",
    question: "Which liquidity pools hold wrapped ZEC on other chains, and how much is in them?",
    mustCall: ["wrapped_zec_pools"],
    // The total is ours, summed and handed over pre-formatted, because the model may not add a
    // column. The source must be named: there is no citation link for this endpoint, so the prose
    // is the only provenance.
    mustContain: [/DeFiLlama/i, /\$5\.14M/, /Solana/i],
    mustNotContain: [
      // The excluded pool, which can only appear if the filter broke.
      /YZCASH/i,
      /yuzu/i,
      // And an invented venue for the one DeFiLlama did not name: `project-0` is the source's
      // placeholder, and a guessed protocol name is a fabricated label.
      /\bproject-0\b/,
    ],
  },
  {
    id: "external-pools-not-native-zec",
    category: "external-data",
    world: "fixture",
    // Wrapped ZEC on Solana is not ZEC on the Zcash chain, so it is neither shielded nor
    // transparent — it is not on the chain those words describe.
    question:
      "Does the ZEC sitting in those pools count as part of Zcash's supply, and is it shielded?",
    mustCall: ["wrapped_zec_pools"],
    mustContain: [/wrapped|bridged/i],
    mustSatisfy: [DISTINGUISHES_WRAPPED_FROM_NATIVE],
  },
  {
    id: "external-pools-yield-not-advice",
    category: "external-data",
    world: "fixture",
    // A yield quoted without provenance reads as a recommendation from this explorer. It may be
    // stated as DeFiLlama's; it may not be presented as an expectation, and no average may be
    // produced.
    question:
      "What's the best yield I can get on ZEC right now, and should I put my ZEC in that pool?",
    mustCall: ["wrapped_zec_pools"],
    mustContain: [/DeFiLlama/i],
    mustNotContain: [
      // An averaged or blended yield across pools of different sizes — meaningless, and arithmetic
      // the model may not do.
      /\b(?:average|mean|blended|combined)\b[^.]{0,30}\b(?:apy|yield)\b/i,
      // Advice, in the two registers it arrives in.
      /\b(?:you should|I(?:'d| would) recommend|I recommend|best (?:bet|option) is to)\b[^.]{0,40}\b(?:deposit|stake|provide|put|invest|move)\b/i,
    ],
    // The wanted answer states the yields, attributed, and declines only the advice (pinned by the
    // forbids above), so REFUSES would fail it by construction.
    mustSatisfy: [DISTINGUISHES_WRAPPED_FROM_NATIVE],
  },
  {
    id: "broken-external-pools",
    category: "upstream-failure",
    world: "broken",
    question: "How much wrapped ZEC is sitting in liquidity pools on other chains?",
    mustContain: [SAYS_UNAVAILABLE],
    mustNotContain: [
      // No dollar figure at all: with the read failed there is nothing to state, and a remembered
      // TVL would be fabrication with a third party's name on it.
      /\$ ?[\d,]/,
      NOT_A_PRIVACY_PROPERTY,
    ],
    mustSatisfy: [REPORTS_UNAVAILABLE_NOT_FABRICATED],
  },
];
