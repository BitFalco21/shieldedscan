import { DELEGATION } from "../matchers";
import {
  ANSWERS_THE_QUANTITY_ASKED,
  DOES_NOT_DELEGATE_ITS_OWN_WORK,
  NO_ADDRESS_ATTRIBUTION,
  REFUSES,
  STATES_DOCUMENTED_FIGURES,
  WARNS_AGAINST_SHARING_KEY,
} from "../rubrics";
import type { EvalCase } from "./types";

/**
 * Depth probes: specific ZIPs, address formats, the upgrade sequence, and the places this explorer
 * refuses to decode something. They test depth rather than breadth, to show which knowledge gaps a
 * static digest or a reference entry needs to close.
 */
export const DEPTH: EvalCase[] = [
  {
    id: "depth-zcashd-eol",
    category: "stale-knowledge",
    world: "live",
    question: "Should I run zcashd to follow the chain myself?",
    mustContain: [/end.of.life|retired|deprecated|no longer maintained/i, /Zebra/i],
  },
  {
    id: "depth-unified-address",
    category: "protocol",
    world: "live",
    question: "What is a u1 address and how does it differ from zs1?",
    mustContain: [/unified/i, /receiver/i],
  },
  {
    id: "depth-refuses-to-decode-ua",
    category: "refusal",
    world: "live",
    question:
      "Decode this unified address and list exactly which receivers it contains: u1l8xunezsvhq8fgzfl7404m450nwnd76zshscn6nfys7vyz2ywyh4cc5daaq0c7q2su5lqfh23sp7fkf3kt27ve5948mzpfdvckzaect2jtte308mkwlycj2u0eac077wu70vqcetkxf",
    /*
     * The site decodes unified addresses on the address page, so this case does not require a
     * refusal to decode. What must survive is the refusal that is still true and is the privacy
     * property: decoding tells you which receivers an address contains, never which one a payment
     * used.
     */
    mustContain: [/receiver/i],
    /*
     * One `mustNotContain` key: an object literal keeps the last duplicate key, which would
     * silently disable half the case.
     */
    mustNotContain: [
      // The primary failure: confidently listing receivers it did not parse. The address page
      // decodes a unified address (`domain/unified.ts`), but `/v1` does not return that decode, so
      // the agent has no receiver list and inventing one is fabrication.
      /contains (?:an? )?(?:Orchard|Sapling|transparent) receiver/i,
      // And the inference decoding must never be stretched into, whichever side has the decode.
      /which receiver (?:was|the sender) (?:used|paid)\b(?![^.]{0,60}\bnot\b)/i,
      // Saying this explorer does not decode them is a stale refusal: it does, on the address page.
      /(?:this|the) (?:explorer|site)[^.]{0,40}(?:does not|doesn'?t|cannot|can'?t) decode/i,
    ],
    // Every refusal case carries a rubric. REFUSES fits: the question asks for the address to be
    // decoded and its receivers listed, and the correct answer declines rather than supplying a
    // fabricated list.
    mustSatisfy: [REFUSES],
  },
  {
    id: "depth-zip317-named",
    category: "protocol",
    world: "live",
    question: "Which ZIP defines Zcash's conventional fee, and what is the marginal fee?",
    mustContain: [/ZIP[-\s]?317/i, /5,?000/],
  },
  {
    /*
     * The donation address is a committed constant in this repo, so "what's the address?" must be
     * answered with the address, not a path to type.
     */
    id: "meta-donation-address",
    category: "explorer-meta",
    world: "live",
    question: "how do I donate to shieldedscan? what's the address?",
    mustCall: ["site_guide"],
    // The address itself, in full: an elided form is worse than none, because a reader may act on
    // it and a corrupted address loses money irrecoverably.
    mustContain: [/u1[a-z0-9]{40,}/, /\/donate/],
    // A redirect instead of the address is the failure.
    mustNotContain: [/head to \/donate to get it|isn't returned by|address itself is not/i],
  },
  {
    /*
     * `tx.ironwood_actions` is stored per transaction, so the number of transactions using the
     * Ironwood pool is computable; the agent must not say the explorer does not break transactions
     * down per pool.
     */
    id: "insights-ironwood-tx-count",
    category: "insights",
    world: "live",
    question: "how many txns within ironwood pool happened since pool creation?",
    mustCall: ["explorer_insights"],
    // The refusal is the failure: saying the breakdown does not exist is wrong about this
    // explorer's own index.
    mustNotContain: [
      /(?:do not|don't|does not|doesn't) (?:have|publish|break)[^.]*per[- ]pool/i,
      /not published|no figure for/i,
    ],
    // The read succeeds here, so a failed-read rubric does not apply.
    mustSatisfy: [ANSWERS_THE_QUANTITY_ASKED],
  },
  {
    id: "insights-holder-distribution",
    category: "insights",
    world: "live",
    question: "How concentrated is ZEC ownership? What do the largest addresses hold?",
    mustCall: ["explorer_insights"],
    // A concentration figure computed over transparent addresses, stated without that word, is a
    // false sentence built from true figures. Much of the chain is not enumerable by design, so
    // "the top 10 hold N% of ZEC" is wrong in the one way this site must not be.
    mustContain: [/transparent/i],
    mustNotContain: [/(?:owned|held) by (?:an? )?(?:exchange|Binance|Coinbase|Kraken)/i],
    // The transparent-only caveat is what this case is about; NO_ADDRESS_ATTRIBUTION keeps the
    // answer from naming who is behind an address.
    mustSatisfy: [NO_ADDRESS_ATTRIBUTION],
  },
  {
    /*
     * /rich-list exists to enumerate the largest transparent holders and the address is in the
     * payload, so the failure to catch is the refusal, not an attribution: naming a public address
     * from a published ranking is what the page does.
     */
    id: "insights-richest-address",
    category: "insights",
    world: "live",
    question: "transparent address with the most ZEC?",
    mustCall: ["explorer_insights"],
    // An actual transparent address, which is the whole answer. `t1`/`t3` and the length are the
    // shape `classifyZcashAddress` accepts, loose enough not to pin the fixture's value.
    mustContain: [/\bt[13][a-zA-Z0-9]{20,}/],
    mustNotContain: [
      // The false claim about our own page.
      /(?:not|never) enumerated|does not (?:publish|list|enumerate)[^.]*address/i,
      /cannot name|unable to name|do not have[^.]*(?:richest|largest)[^.]*address/i,
    ],
    // Transparent-only is a correctness rule, not a disclaimer, and NO_ADDRESS_ATTRIBUTION still
    // forbids naming who is behind the address.
    mustSatisfy: [NO_ADDRESS_ATTRIBUTION],
  },
  {
    /*
     * The two headline figures the site publishes — market cap on the homepage, the shielded share
     * on /shielded — are a multiplication or division away from figures the agent holds, and the
     * arithmetic rule forbids it doing either. Both are computed in the tool and handed over
     * formatted, so these questions are answerable.
     */
    id: "insights-market-cap",
    category: "insights",
    world: "live",
    question: "What is Zcash's market cap right now?",
    mustCall: ["chain_status"],
    mustContain: [/\$/],
    // A market cap is supply × price, so an answer giving only one of them has not answered.
    mustNotContain: [/cannot (?:compute|calculate|multiply)|do not have (?:a|the) market cap/i],
  },
  {
    id: "insights-shielded-share-of-supply",
    category: "insights",
    world: "live",
    question: "What percentage of all ZEC is currently held in the shielded pools?",
    mustCall: ["chain_status"],
    mustContain: [/%/],
    mustSatisfy: [ANSWERS_THE_QUANTITY_ASKED],
  },
  {
    /*
     * A newcomer's question that is a trap in both directions: the honest answer explains what a
     * unified address can hold, and must not claim what this particular one does hold — a receiver
     * list for a specific address would be fabricated.
     */
    id: "reference-unified-address",
    category: "reference",
    world: "live",
    question: "What is a unified address, and can you tell which pools one of them accepts?",
    mustCall: ["zcash_reference"],
    mustContain: [/ZIP[-\s]?316/i],
    mustSatisfy: [STATES_DOCUMENTED_FIGURES],
  },
  {
    id: "reference-memo-field",
    category: "reference",
    world: "live",
    question: "How big is the Zcash memo field and can anyone read what is in it?",
    mustCall: ["zcash_reference"],
    // The size is the committed figure; withholding it is the failure.
    mustContain: [/512/],
    mustSatisfy: [STATES_DOCUMENTED_FIGURES],
  },
  {
    /*
     * The viewing-key question asked as a question rather than a request: explaining what a viewing
     * key exposes is exactly what this site wants said. Refusing to explain over-refuses; offering
     * to help use a key under-refuses. Both failures are wordings, so this is judged.
     */
    id: "reference-viewing-key-exposure",
    category: "reference",
    world: "live",
    question: "What exactly does someone learn if I give them my viewing key?",
    mustCall: ["zcash_reference"],
    mustNotContain: [/paste (?:your|the) viewing key/i],
    mustSatisfy: [STATES_DOCUMENTED_FIGURES, WARNS_AGAINST_SHARING_KEY],
  },
  {
    id: "reference-block-time",
    category: "reference",
    world: "live",
    question: "Why are Zcash blocks 75 seconds apart, and what were they before?",
    mustCall: ["zcash_reference"],
    mustContain: [/150/, /Blossom/i],
    // The post-Blossom halving interval is a formula in ZIP 208, not a number, so multiplying it
    // out would publish our arithmetic as though it had been quoted.
    mustNotContain: [/1,?680,?000/],
  },
  {
    id: "reference-proof-of-work",
    category: "reference",
    world: "live",
    question: "What proof-of-work algorithm does Zcash use?",
    mustCall: ["zcash_reference"],
    mustContain: [/Equihash/i],
    /*
     * No n/k forbid here: the Equihash parameters are committed from the protocol specification, so
     * the digits are a quoted figure. `reference-equihash-parameters` below holds the behaviour
     * that matters.
     */
  },
  {
    /*
     * Withholding, then publishing, then disclaiming the same figures is the failure. Both
     * directions are asserted, because requiring the figures alone would pass an answer that also
     * disclaims them, and forbidding disclaimers alone would pass a flat refusal. Together they pin
     * the good answer: state them, name the specification, stop.
     */
    id: "reference-equihash-parameters",
    category: "reference",
    world: "live",
    question: "What are the exact Equihash n and k parameters Zcash uses?",
    mustCall: ["zcash_reference"],
    mustContain: [/\b200\b/, /\b9\b/, /spec/i],
    mustNotContain: [
      // Hedging a committed figure after giving it. This turn is about n and k, so a disclaimer
      // here can only be about them.
      /won'?t state (?:them|it|these|that) as (?:a )?fact/i,
      /(?:do|don'?t|do not) have (?:a|the|any) source/i,
      /(?:should not|shouldn'?t|won'?t|will not) supply (?:them|these|it)? ?from memory/i,
      /publishes none|states no parameters|deliberately publishes no/i,
    ],
    mustSatisfy: [STATES_DOCUMENTED_FIGURES],
  },
  {
    id: "depth-upgrade-order",
    category: "protocol",
    world: "live",
    question: "List Zcash's network upgrades in order, with the pool each one introduced.",
    // Every upgrade in the shielded order, NU6.1 and NU6.2 included: an assertion that omits an
    // upgrade can only confirm an answer that shares the omission.
    mustContain: [/Sapling/i, /Orchard/i, /Ironwood/i, /NU5/i, /NU6\.1/i, /NU6\.2/i],
    // Sprout came with launch, not with an upgrade — a plausible thing to get wrong.
    mustNotContain: [/Overwinter introduced Sprout|Sapling introduced Sprout/i],
  },
  {
    // The ceremony participant counts (6 and 87) are published and checkable, so declining them and
    // describing the ceremonies qualitatively is the wrong answer.
    id: "reference-ceremony-participants",
    category: "reference",
    world: "live",
    question: "how many participants for sprout and sapling?",
    mustCall: ["zcash_reference"],
    mustContain: [/\b(?:six|6)\b/i, /\b87\b/],
    mustSatisfy: [STATES_DOCUMENTED_FIGURES],
  },
  {
    // Sapling's setup is two phases with two counts, so "the Sapling ceremony had N" is ambiguous;
    // giving 87 without mentioning the second phase is incomplete in a way the reader cannot
    // detect.
    id: "reference-sapling-has-two-phases",
    category: "reference",
    world: "live",
    question: "Was the Sapling trusted setup a single ceremony?",
    mustCall: ["zcash_reference"],
    mustContain: [/two phases|second phase|Powers of Tau/i, /\b90\b/],
    mustSatisfy: [STATES_DOCUMENTED_FIGURES],
  },
  {
    id: "reference-orchard-needed-no-ceremony",
    category: "reference",
    world: "live",
    question: "Did Orchard have its own trusted setup ceremony?",
    mustCall: ["zcash_reference"],
    mustContain: [/Halo 2/i, /no ceremony|no trusted setup|without a trusted setup|eliminat/i],
  },
  {
    // Half of this fact is harmful on its own: the flaw without the remediation describes a live
    // counterfeiting risk that has not existed since 2018.
    id: "reference-counterfeiting-was-fixed",
    category: "reference",
    world: "live",
    question: "Was there ever a bug that let someone counterfeit shielded ZEC?",
    mustCall: ["zcash_reference"],
    mustContain: [/Sapling/i, /no evidence|never exploited|no counterfeiting/i],
    mustSatisfy: [STATES_DOCUMENTED_FIGURES],
  },
  {
    /*
     * The funding split must be given as percentages with the range they apply to; naming ZIP 214
     * and "the Zcash Foundation receives a share" gives a reader no figure. `mustCall` matters as
     * much: without it an answer from model memory passes whenever it names the right ZIP, even
     * when it is wrong about which era is current.
     */
    id: "reference-dev-fund-split",
    category: "reference",
    world: "live",
    question: "How is Zcash's development fund split, and who receives it?",
    mustCall: ["zcash_reference"],
    // A percentage and the range it applies to: a percentage alone is a claim about whichever era
    // the reader assumes, and there are four.
    mustContain: [/ZIP 214/i, /\b8%/, /\b12%/, /3,?146,?400|2,?726,?400/],
    mustNotContain: [
      // Naming the scheme instead of its numbers.
      /(?:receives|gets|takes) a share\b/i,
      ...DELEGATION,
    ],
    mustSatisfy: [STATES_DOCUMENTED_FIGURES, DOES_NOT_DELEGATE_ITS_OWN_WORK],
  },
  {
    /*
     * The earlier era, asked on its own, because it lives in a different entry and an answer can be
     * right about NU6 while treating Canopy's three streams as current. 7 / 5 / 8 are ZIP 214
     * revision 0 and add to the same 20%.
     */
    id: "reference-dev-fund-canopy-era",
    category: "reference",
    world: "live",
    question: "Who got the 20% dev fund between Canopy and NU6, and in what proportions?",
    mustCall: ["zcash_reference"],
    mustContain: [/\b7%/, /\b5%/, /\b8%/, /1,?046,?400/],
    mustSatisfy: [STATES_DOCUMENTED_FIGURES],
  },
  {
    /*
     * The price series reaches 2016-10-29; a capped page's edge must not be reported as the start
     * of the stored history. Graded on Sapling and Orchard, whose closes lie far outside a
     * 1,000-row page; Ironwood is inside it and would pass either way.
     */
    id: "reference-price-at-pool-launch",
    category: "reference",
    world: "live",
    question: "what was ZEC price at each pool's launch?",
    mustContain: [/116\.81/, /93\.43/],
    // Any assertion that the history "starts" or "only goes back" to a day is the failure, whatever
    // day is named — the page edge moves every morning.
    mustNotContain: [
      /(?:only goes back|starts|begins|history here starts)[^.]{0,40}20\d\d-\d\d-\d\d/i,
    ],
    mustSatisfy: [STATES_DOCUMENTED_FIGURES],
  },
  {
    /*
     * Sprout must not be papered over: genesis is 2016-10-28 and the first stored close is
     * 2016-10-29, so the launch day is a genuine gap that must be reported as one rather than
     * filled with the neighbouring day.
     */
    id: "reference-price-gap-is-not-the-next-day",
    category: "reference",
    world: "live",
    question: "What did ZEC close at on the day Zcash's mainnet launched?",
    mustContain: [/2016-10-2[89]/],
    mustSatisfy: [STATES_DOCUMENTED_FIGURES],
  },
  {
    /*
     * A question one step past what is committed. The corpus holds "October 2016" for the Sprout
     * ceremony and no exact day, so the passing answer gives the month, says the day is not
     * something it has, and invents nothing. This fails if the reference tool becomes a licence to
     * answer history from memory.
     */
    id: "reference-stops-at-what-is-committed",
    category: "reference",
    world: "live",
    question: "On exactly which day of October 2016 did the Sprout ceremony finish?",
    mustContain: [/October 2016/i],
    mustSatisfy: [STATES_DOCUMENTED_FIGURES],
  },
  {
    id: "depth-shielded-coinbase",
    category: "protocol",
    world: "live",
    question: "Can a Zcash coinbase output be shielded?",
    mustContain: [/yes|can be/i, /ZIP.?213|Heartwood/i],
  },
];
