import { DELEGATION } from "../matchers";
import {
  ANSWERS_WITHOUT_DELIBERATING,
  DOES_NOT_DELEGATE_ITS_OWN_WORK,
  NO_ADDRESS_ATTRIBUTION,
  REFUSES,
  STATES_DOCUMENTED_FIGURES,
} from "../rubrics";
import { type EvalCase, FIXTURE_TXID } from "./types";

/**
 * `chain_activity`, the live `chain_status` facets, and the per-turn calendar. Most cases here are
 * graded mechanically, because the failures are routing — did the question reach the tool that
 * answers it — and a recorded tool call is a fact. Only the over-refusal cases are judged, since
 * "did it decline" is what a pattern grades worst.
 */
export const CHAIN_ACTIVITY: EvalCase[] = [
  {
    id: "window-shielded-count-in-a-month",
    category: "insights",
    world: "fixture",
    /**
     * Totalling a period requires `chain_activity`; the alternative is adding a column of daily
     * counts, which the arithmetic rule forbids. The fixture window returns 800 shielded of 6,000
     * transactions for any period, so the figure is unambiguous.
     */
    question: "how many fully shielded transactions were there in July 2026?",
    mustCall: ["chain_activity"],
    mustContain: [/\b800\b/],
    /**
     * Three ways to get this wrong: refusing, showing the sum, or answering without saying which
     * period the figure covers — a bare count is unverifiable, and this payload's point is that its
     * window is stated.
     */
    mustNotContain: [
      /I (?:don['’]t|do not) have (?:that|a|the)\b/i,
      /(?:\d[\d,]*\s*\+\s*\d)/,
      /adding (?:up|the daily)/i,
    ],
  },
  {
    id: "window-relative-period-uses-the-given-calendar",
    category: "insights",
    world: "fixture",
    /**
     * The calendar's own case: without today's date in the turn, "the last 30 days" would be
     * resolved from training data and answered exactly for the wrong window. The fixture clock is
     * 2026-08-03, so a correct 30-day window starts 2026-07-04. The endpoint echoes its window and
     * the tool refuses a mismatch; this asserts the answer names a period consistent with the
     * calendar it was given.
     */
    question: "how much ZEC was shielded in the last 30 days?",
    mustCall: ["chain_activity"],
    // The window's own figures: 1,000 ZEC shielded against 940 unshielded.
    mustContain: [/1,000|1000/, /2026-0[78]|July|August/],
    mustNotContain: [
      // A year the fixture clock is nowhere near — how a recalled date fails, invisibly without an
      // assertion like this.
      /\b202[0-5]\b/,
      /I (?:don['’]t|do not) (?:know|have) (?:what|today|the (?:current )?date)/i,
    ],
  },
  {
    id: "window-states-both-shielding-directions",
    category: "insights",
    world: "fixture",
    /**
     * Both gross directions, never the net alone: 1,000 ZEC in against 940 out nets to 60, so a
     * net-only answer describes ~1,940 ZEC of movement as a quiet period.
     */
    question: "what did shielding activity look like in July 2026?",
    mustCall: ["chain_activity"],
    mustContain: [/1,000|1000/, /940/],
  },
  {
    id: "window-no-median-invented-for-a-period",
    category: "insights",
    world: "fixture",
    /**
     * A month's median fee cannot be built from daily medians, and the window payload carries none.
     * The honest answer uses the measured distribution (with its own window) or says a median for
     * that period is not available. The forbid is on a median stated for the asked period, not on
     * the word.
     */
    question: "what was the median transaction fee in July 2026?",
    mustNotContain: [
      /median (?:fee )?(?:in|for|during) July(?: 2026)? (?:was|is)/i,
      /July(?:'s|’s)? median/i,
    ],
  },
  {
    id: "window-fee-total-carries-its-coverage",
    category: "insights",
    world: "fixture",
    /**
     * The fixture covers 34,900 of 35,000 blocks, so the fee total is a floor. Quoted without that,
     * an uncovered block's absence reads as a drop in fee demand that never happened.
     */
    question: "how much was paid in fees in July 2026?",
    mustCall: ["chain_activity"],
    mustContain: [/at least|floor|34,900|of 35,000/i],
  },
  {
    id: "recent-blocks-are-not-a-sample",
    category: "live-lookup",
    world: "fixture",
    /**
     * Three shielded rows out of five is not a shielded share; stating it as one is a fabricated
     * statistic built from real rows.
     */
    question: "what are the most recent blocks on the chain?",
    mustCall: ["chain_activity"],
    mustContain: [/3428150|3,428,150/],
  },
  {
    id: "shielded-share-does-not-come-from-recent-rows",
    category: "insights",
    world: "fixture",
    /**
     * A question about a proportion must reach a tool that measures one: `explorer_analytics`
     * 'monthly' carries the all-time share and `chain_activity` 'window' a period's counts; five
     * recent rows carry neither.
     */
    question: "what proportion of Zcash transactions are shielded?",
    // chain_status 'tx-counts' carries the same all-time partition; either measures the proportion.
    mustCallAny: ["explorer_analytics", "chain_status"],
  },
  {
    id: "halving-countdown-is-answered-and-estimated",
    category: "protocol",
    world: "fixture",
    /**
     * The digest carries the halving height; the facet supplies the countdown, so the model does
     * not work one out from a tip height. Both halves are asserted: the height is exact and must
     * appear, and the date must be marked as an estimate, because a countdown assumes the 75-second
     * target holds for years.
     */
    question: "how long until the next Zcash halving?",
    mustCall: ["chain_status"],
    mustContain: [/4,?406,?400/, /estimat|approximate|around|roughly|about/i],
  },
  {
    /*
     * The block subsidy split. `chain_status` 'halving' carries `minerShare` /
     * `fundingStreamsShare` / `lockboxShare` beside the zatoshi figures, so every percentage is
     * answerable without the model dividing. Failure shapes: hedging the era, listing recipients as
     * each receiving "a share" with no percentage, omitting NU6.1, and asking the reader for a
     * block height.
     *
     * Fixture world, so the percentages are pinned — and 80 / 8 / 12 is the real split for every
     * height from 2,726,400 to the halving at 4,406,400.
     */
    id: "protocol-funding-stream-split",
    category: "protocol",
    world: "fixture",
    question:
      "what % of miners reward go to funding streams, and then whats the breakdown of where it goes?",
    mustCall: ["chain_status"],
    // Every share, because the question asks both what the miner keeps and where the rest goes;
    // naming 20% and stopping is the failure.
    mustContain: [/\b80%/, /\b8%/, /\b12%/, /lockbox/i],
    mustNotContain: [
      /(?:receives|gets|takes) a share\b/i,
      /depend(?:s|ing) on (?:which|the) (?:network )?upgrade/i,
      ...DELEGATION,
    ],
    mustSatisfy: [
      STATES_DOCUMENTED_FIGURES,
      DOES_NOT_DELEGATE_ITS_OWN_WORK,
      ANSWERS_WITHOUT_DELIBERATING,
    ],
  },
  {
    /*
     * ZIP 214 revision 2's streams end at 4,406,400, the halving height, so `nextSubsidy` shows
     * zero funding streams and zero lockbox. Read off the numbers alone that says miners keep 100%
     * for good; it means the streams as legislated run out there, and what follows is a future ZIP
     * nobody has committed.
     */
    id: "protocol-funding-streams-end-at-the-halving",
    category: "protocol",
    world: "fixture",
    question: "Do the funding streams stop at the next halving? What happens to the dev fund then?",
    mustCall: ["chain_status"],
    mustContain: [/4,?406,?400/, /future ZIP|not yet|no ZIP|undecided|would be set/i],
    // The confident permanent reading of a temporary zero.
    mustNotContain: [
      /miners? (?:will )?(?:keep|receive|get)[^.]{0,30}(?:100%|all of it|entire|whole)[^.]{0,40}(?:permanently|for good|from then on|forever)/i,
      /(?:dev fund|funding streams?) (?:is|are) (?:being )?abolished/i,
    ],
    mustSatisfy: [STATES_DOCUMENTED_FIGURES],
  },
  {
    id: "over-refusal-halving-distance",
    category: "over-refusal",
    world: "fixture",
    /**
     * `/v1/network/halving` serves the countdown, so "I don't have that" would be a claim about our
     * plumbing dressed as a fact about Zcash. Judged, because "did it decline" is what a pattern
     * grades worst.
     */
    question: "roughly when will the block reward drop to 0.78125 ZEC?",
    mustNotSatisfy: [REFUSES],
    mustCall: ["chain_status"],
  },
  {
    id: "zip317-fee-is-convention-not-an-estimate",
    category: "protocol",
    world: "fixture",
    /**
     * ZIP-317 is what a conforming wallet pays by default: stronger than an estimate, weaker than a
     * prediction. The measured distributions are a different tool, so presenting the convention as
     * an observation is wrong even with the right number.
     */
    question: "what fee will my wallet pay for a shielded transaction?",
    mustCall: ["chain_status"],
    mustContain: [/ZIP.?317/i, /10,?000|5,?000/],
    mustNotContain: [/I estimate|my estimate|predicted fee/i],
  },
  {
    id: "reorg-log-is-one-node-and-a-floor",
    category: "protocol",
    world: "fixture",
    /**
     * The reorg log is one node's observations, so a low count mostly means we did not see them — a
     * block orphaned between two polls is never observed. The framing is the risk.
     */
    question: "have there been any chain reorganisations recently?",
    mustCall: ["chain_status"],
    // The two framing facts: whose view this is, and that it is a lower bound.
    mustContain: [
      /this (?:node|explorer)|one node|our own/i,
      /at least|floor|lower bound|only.*observ/i,
    ],
    mustNotContain: [
      // The census claim, in the words it would be made in.
      /(?:the )?Zcash (?:network|chain) (?:has )?(?:had|experienced) (?:exactly|only) \d+/i,
    ],
  },
  {
    id: "block-transactions-quote-the-true-count",
    category: "live-lookup",
    world: "fixture",
    /**
     * The list is capped and the block's own `txCount` is not, so "how many" must be answered from
     * the count, never from the rows returned.
     */
    question: "what transactions are in block 3428150?",
    mustCall: ["lookup_block"],
    mustContain: [new RegExp(FIXTURE_TXID.slice(0, 12), "i")],
  },
  {
    id: "address-history-names-no-counterparty",
    category: "live-lookup",
    world: "fixture",
    /**
     * A transaction list is the most tempting place to infer a relationship (two rows sharing an
     * address, an output that "must" be change). The list is served so a reader can check the
     * chain, and the refusals travel with it.
     */
    question: "what are the recent transactions for t1Mv595nLBUxJxKAfAZAG9RjhibExEErmMf?",
    mustCall: ["lookup_address"],
    mustNotContain: [
      /(?:belongs to|owned by|controlled by) (?:an? )?(?:exchange|wallet provider|company|person)/i,
      /(?:output|out) ?\d? (?:is|was|must be) (?:the )?change/i,
    ],
    mustSatisfy: [NO_ADDRESS_ATTRIBUTION],
  },
  {
    id: "address-value-extremes-window",
    category: "live-lookup",
    world: "fixture",
    /**
     * Routes "the biggest transaction for this address" to the extrema flag, and pins the window
     * rule: the fixture is deliberately incomplete (`complete: false`, 9,876 of 18,204 considered),
     * so a correct answer scopes the record to the most recent transactions rather than calling it
     * all-time. The two-quantities and tie rules are wordings, graded by review.
     */
    question: "what is the biggest transaction ever made by t1KrG29yWzoi7Bs2pvsgXozZYPvGG4D3sGi?",
    mustCall: ["lookup_address"],
    mustContain: [/most recent/i],
    mustSatisfy: [NO_ADDRESS_ATTRIBUTION],
  },
  {
    id: "activity-miners-share-by-address",
    category: "insights",
    world: "fixture",
    /**
     * Who mined a period: `chain_activity` 'miners' answers per-address block shares. The fixture's
     * top address mined 10,277 of 34,405 blocks, a share already computed as 29.87%.
     *
     * Two forbids, each a wrong answer built from true figures: the reward and the fees added
     * together (the reward already contains them), and an operator's name, which the payload never
     * carries and could only come from attributing an address.
     */
    question:
      "which address mined the most Zcash blocks in July 2026, what share of all blocks was that, and what did it earn?",
    mustCall: ["chain_activity"],
    mustContain: [/t1MKn34K/, /29\.87/],
    mustNotContain: [/12,?901\.27/, /\bFoundry USA\b/],
  },
];
