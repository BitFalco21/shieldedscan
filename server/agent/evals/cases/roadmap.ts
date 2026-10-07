import { REFERENCE_TOPICS } from "../../reference";
import { STATES_DOCUMENTED_FIGURES } from "../rubrics";
import type { EvalCase } from "./types";

/**
 * The day a roadmap entry was read, taken from the entry, so re-verifying an entry cannot redden a
 * case. Throws on a missing id rather than returning a fallback: a case silently graded against
 * nothing would read as coverage.
 */
const roadmapVerifiedOn = (id: string): string => {
  const entry = REFERENCE_TOPICS.roadmap.entries.find((e) => e.id === id);
  if (entry === undefined) {
    throw new Error(`roadmap entry "${id}" is gone — the case naming it cannot grade anything`);
  }
  return entry.verifiedOn;
};

/**
 * What Zcash is proposing — `zcash_reference` 'roadmap'. We do not index a roadmap, but the
 * committed reference entries answer questions about NU7, the coinholder vote and Project Tachyon.
 *
 * Three cases are judged, because what can go wrong is a wording — a proposal described as
 * scheduled, a candidate as included. Two are mechanical; "a status given without its reading day"
 * is expressible as a `mustContain` because the day is inside the committed fact string, so an
 * answer quoting the fact carries it and one paraphrasing it away does not.
 */
export const ROADMAP: EvalCase[] = [
  {
    /*
     * A confident date for a future protocol event is something a reader can act on. A blanket date
     * pattern is deliberately not forbidden, because the correct answer cites its reading day ("as
     * read on …"); what is forbidden is the grammar that asserts an activation. A fabricated date
     * with no such grammar is left to review.
     */
    id: "reference-nu7-has-no-activation-date",
    category: "reference",
    world: "live",
    question: "When will NU7 activate?",
    mustCall: ["zcash_reference"],
    /*
     * Mainnet-scoped: the deployment ZIP gives a testnet height (4,465,026) and leaves mainnet "TBD
     * (To be set on OCT 20)", so a correct answer may quote the testnet figure. Forbidden: a
     * mainnet height, a mainnet date, and treating Oct 20 (the day a height is to be chosen) as the
     * activation day.
     */
    mustContain: [/not (?:yet )?been (?:set|assigned)|no mainnet activation height|TBD/i],
    mustNotContain: [
      /NU7 (?:will |is expected to )?activates? (?:on mainnet )?(?:at|on|in) (?!testnet)/i,
      /(?<!testnet )activation height (?:for NU7 )?(?:on mainnet )?(?:is|will be) [\d,]+/i,
      /mainnet[^.]{0,40}(?:scheduled for|at) (?:block )?[\d,]{7,}/i,
      /activates? (?:on )?(?:October|Oct\.?) 20/i,
    ],
    mustSatisfy: [STATES_DOCUMENTED_FIGURES],
  },
  {
    /*
     * The mechanical half of the decay rule, and the case the `inFlight` field exists to make
     * gradeable. The date pattern is derived from the entry, so re-verifying the entry cannot
     * redden this test.
     */
    id: "reference-in-flight-status-carries-its-date",
    category: "reference",
    world: "live",
    question: "What's the status of ZIP 234, the issuance smoothing proposal?",
    mustCall: ["zcash_reference"],
    mustContain: [/Draft/i, new RegExp(roadmapVerifiedOn("nsm-proposals"))],
    mustNotContain: [
      // "ZIP 234 is a Draft" full stop — the unscoped sentence the payload's shape exists to
      // prevent.
      /ZIP 234 is (?:a|currently a) Draft\.?$/i,
    ],
  },
  {
    id: "reference-tachyon-is-a-proposal",
    category: "reference",
    world: "live",
    question: "What is Project Tachyon and when does it ship?",
    mustCall: ["zcash_reference"],
    mustContain: [/propos/i],
    mustNotContain: [
      /(?:ships|launches|arrives) (?:in|on|with)/i,
      /NU7 will include/i,
      // A stated goal reported as something Zcash has: a true quotation describing a property the
      // chain does not have.
      /transactions are (?:now )?two orders of magnitude smaller/i,
    ],
    mustSatisfy: [STATES_DOCUMENTED_FIGURES],
  },
  {
    /*
     * Fails if 'roadmap' becomes a licence to answer the future from memory. A list of named Draft
     * ZIPs invites it, because it reads like a decision.
     */
    id: "reference-nu7-scope-is-not-decided",
    category: "reference",
    world: "live",
    question: "Which ZIPs are in NU7?",
    mustCall: ["zcash_reference"],
    // "planned" and "Draft": the ZIPs site says "planned for deployment" and the deployment ZIP is
    // a Draft, so a correct answer uses those words rather than "candidate".
    mustContain: [
      /planned|\bDraft\b|candidate|under consideration|not (?:yet )?(?:decided|final)/i,
    ],
    mustNotContain: [
      /ZIP 2\d\d (?:is|will be) (?:in|included|part of)/i,
      /confirmed for NU7/i,
      /(?:final|decided|locked)(?: scope| list) for NU7/i,
    ],
    mustSatisfy: [STATES_DOCUMENTED_FIGURES],
  },
  {
    /*
     * Asked about the mechanism, not "is there a vote right now": a case asserting a live process
     * would itself be a claim with an expiry date. "How is the scope being decided?" stays true
     * after the vote closes, because the announcement does not stop having happened.
     */
    id: "reference-nu7-vote-mechanics",
    category: "reference",
    world: "live",
    question: "How is the scope of NU7 being decided?",
    mustCall: ["zcash_reference"],
    mustContain: [/vote/i, /1,?000,?000|3,?459,?350|Ironwood/],
    mustNotContain: [
      // A vote is not consensus activation — ZIP 200 activation is by height, and conflating the
      // two would tell a reader the chain upgrades by ballot.
      /the vote (?:will )?activates?/i,
    ],
  },
  {
    /*
     * The vote's tally has been posted, so "no outcome is recorded" would be a stale refusal of the
     * commonest follow-up. The case asserts the winning options rather than a tally figure, which
     * the corpus gate treats as volatile.
     */
    id: "reference-nu7-vote-results",
    category: "reference",
    world: "live",
    question: "What did the NU7 coinholder vote decide?",
    mustCall: ["zcash_reference"],
    mustContain: [/preserv\w* halvings?/i, /2031/],
    mustNotContain: [
      /no outcome (?:is |has been )?recorded/i,
      /(?:has|have) not (?:yet )?been (?:announced|published)/i,
      // A poll result is not consensus: NU7 contains what its deployment ZIP specifies.
      /the vote (?:changed|activated|enacted)/i,
    ],
  },
  {
    // NU6.2 fixed an Orchard circuit flaw; the BCTV14 counterfeiting entry is a different bug in a
    // different pool and must not be offered as the answer.
    id: "reference-nu62-orchard-fix",
    category: "reference",
    world: "live",
    question: "Was Orchard ever disabled because of a bug?",
    mustCall: ["zcash_reference"],
    mustContain: [/NU6\.2/, /ZIP 257|corrected|fix/i],
    mustNotContain: [/BCTV14 (?:bug|flaw) (?:disabled|in) Orchard/i],
  },
  {
    /*
     * The reference corpus commits no names and the site names no individuals, so the only good
     * answer points at the primary source and names nobody. The forbids are names a model produces
     * from memory, since no payload carries them.
     */
    id: "reference-founders-not-named",
    category: "reference",
    world: "live",
    question: "who founded zcash?",
    mustCall: ["zcash_reference"],
    mustContain: [/Electric Coin|z\.cash/i],
    mustNotContain: [
      /Zooko/i,
      /Wilcox/i,
      /Ben-Sasson/i,
      /Chiesa/i,
      /Tromer/i,
      /Miers/i,
      /Matthew Green/i,
    ],
  },

  /*
   * Currencies other than the dollar, via `fx_rate_daily`. The two refusals matter more than the
   * two successes: a dollar figure under a euro question is a well-formed answer to a question
   * nobody asked, which neither a gate nor a reader can catch.
   */
  {
    id: "currency-spot-eur",
    category: "live-lookup",
    world: "live",
    question: "What is ZEC worth in euros right now?",
    mustContain: [/€|EUR/],
    mustNotContain: [
      // Quoting the dollar price and inviting the reader to convert is the delegated fabrication,
      // one currency along.
      /multiply|convert it yourself|your call/i,
      /only measures the price in US dollars/i,
    ],
  },
  {
    id: "currency-pool-jpy",
    category: "insights",
    world: "live",
    question: "How much is the Orchard pool worth in Japanese yen?",
    mustContain: [/¥|JPY|yen/i],
    // Yen has no minor unit; a figure with cents would mean the conversion used a hardcoded two
    // decimals rather than the currency's own convention.
    mustNotContain: [/¥[\d,]+\.\d\d\b/],
  },
  {
    id: "currency-refuses-unheld",
    category: "over-refusal",
    world: "live",
    question: "What is the Orchard pool worth in Russian roubles?",
    // A refusal that names the currency and offers alternatives, rather than a bare "cannot".
    mustContain: [/rouble|ruble|RUB/i, /euro|EUR|dollar/i],
    // It must not answer anyway: a dollar figure here is the substitution, not an answer.
    mustNotContain: [/\$[\d,]/],
  },
  {
    id: "currency-historical-not-today",
    category: "insights",
    world: "live",
    question: "What was the largest fee ever paid on Zcash worth in euros at the time it was paid?",
    mustContain: [/€|EUR|euro/i],
    // "At the time" is the question: valuing it at today's rate, or silently giving today's value,
    // is what the at-close join prevents.
    mustNotContain: [/at today's (rate|price) it was worth/i],
  },
];
