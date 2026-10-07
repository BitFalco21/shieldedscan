import { DELEGATION, NOT_A_PRIVACY_PROPERTY, SAYS_UNAVAILABLE, unlessNegated } from "../matchers";
import {
  ANSWERS_THE_QUANTITY_ASKED,
  DOES_NOT_DELEGATE_ITS_OWN_WORK,
  KEEPS_ONE_SOURCE_PER_COMPARISON,
  NO_ADDRESS_ATTRIBUTION,
  REPORTS_UNAVAILABLE_NOT_FABRICATED,
} from "../rubrics";
import type { EvalCase } from "./types";

/**
 * The `explorer_insights` topics. Fixture world because the private analytics API is token-gated,
 * and a case that silently degraded to synthetic figures while reporting itself live would be worse
 * than one that never ran. The fixtures close the Ironwood identity exactly and put clean numbers
 * under the percentages, so these assert a figure rather than a vocabulary. Every case asserts
 * something mechanical as well as anything semantic (see `grade.ts`).
 */
export const INSIGHTS: EvalCase[] = [
  {
    id: "insights-ironwood-source",
    category: "insights",
    world: "fixture",
    question: "Where did the ZEC now held in the Ironwood pool come from?",
    mustCall: ["explorer_insights"],
    // Both source classes must appear: most of the pool migrated from Orchard, and a notable share
    // was shielded straight from transparent.
    mustContain: [/Orchard/i, /transparent/i],
  },
  {
    id: "insights-orchard-migration-ratio",
    category: "insights",
    world: "fixture",
    // The Orchard→Ironwood ratio is computed by `ironwoodSourceShares` and the tool description
    // names Orchard, so the question routes and the figure is supplied ready to quote.
    question: "what is the ratio of zec that moved from orchard to ironwood?",
    mustCall: ["explorer_insights"],
    // 89.7% exactly: 74,000,000,000,000 of 82,500,000,000,000 in the fixture, computed by
    // `ironwoodSourceShares`.
    mustContain: [/89\.7/, /Orchard/i],
    // The refusal shapes, plus the recomputed form: 74/82.5 by calculator gives 89.69696…, so a raw
    // recompute quoted instead of the published 89.7 shows up as that digit pair. Payload figures
    // are preferred; the calculator is for what the data does not carry.
    mustNotContain: [
      /I (?:don['’]t|do not) have (?:a |the )?figure/i,
      /would be guessing/i,
      /89\.69/,
    ],
  },
  {
    id: "insights-ironwood-migrations-24h",
    category: "insights",
    world: "fixture",
    // Windowed pool-to-pool migration counts are in the payload (`migrations` per window, computed
    // in SQL). The fixture's last-24-hours Orchard-only count is 35, distinguishable from the wrong
    // window (301 for 7d, 1,160 for 30d) or the wrong population (37 total, 9,640 bundle-carrying).
    question: "how many txns from orchard to ironwood in the last 24hrs?",
    mustCall: ["explorer_insights"],
    mustContain: [/\b35\b/],
    // The refusal shapes this guards against.
    mustNotContain: [
      /(?:aren['’]t|are not|isn['’]t|is not) broken (?:out|down)/i,
      /(?:don['’]t|do not) have that (?:measurement|figure)/i,
    ],
  },
  {
    id: "insights-pool-migration-matrix-usd",
    category: "insights",
    world: "fixture",
    // The payload carries the full pair matrix per window with a finished value string each, so
    // other directions and their dollar values are answerable; offering the spot price for the
    // reader to value the total by hand is the failure.
    question:
      "give me all number of txns from and to each pools (do all scenarios) in last 24hrs in zec and $ volume at transfer time",
    mustCall: ["explorer_insights"],
    // The fixture's 24h window: the non-Ironwood pair must appear (orchard→ironwood alone is the
    // narrower answer), and a dollar figure must be quoted from the payload.
    mustContain: [/\b35\b/, /sapling\s*(?:→|->|to)\s*orchard/i, /\$157,080/],
    mustNotContain: [
      /carry no dollar values|no (?:usd|dollar) (?:value|figure|data)/i,
      /(?:aren['’]t|are not) (?:indexed|broken (?:out|down))/i,
      ...DELEGATION,
    ],
    mustSatisfy: [DOES_NOT_DELEGATE_ITS_OWN_WORK],
  },
  {
    id: "calc-migration-share",
    category: "insights",
    world: "fixture",
    // The calculator's intended use: a derivation the payload does not carry, computed through the
    // tool with the expression on record. The 24h window totals 4,620 ZEC of which orchard→ironwood
    // is 4,000, so the honest answer is 86.6%; a by-eye or wrong-operand figure (against the 7d
    // window it gives 12.5%) is visible.
    question:
      "what share of the last 24 hours' pool migration volume went from orchard to ironwood?",
    mustCall: ["explorer_insights", "calculate"],
    mustContain: [/86\.5|86\.6/],
    mustNotContain: [...DELEGATION],
  },
  {
    id: "calc-hypothetical-current-price",
    category: "insights",
    world: "fixture",
    // A reader's own what-if: legitimate arithmetic on a stated basis. The fixture price is $60, so
    // 250 ZEC is exactly $15,000, reached through chain_status for the price and calculate for the
    // product — never by handing the price back for the reader to multiply.
    question: "how much would 250 ZEC be worth at the current ZEC price?",
    mustCall: ["chain_status", "calculate"],
    mustContain: [/\$15,000/],
    mustNotContain: [...DELEGATION],
  },
  {
    id: "insights-pool-migration-other-pools",
    category: "insights",
    world: "fixture",
    // The directed migration matrix is a sum over `chain_day_pool_migration` for any window,
    // including all of history, so this must be answered from the window matrix. The failure
    // directions are a refusal and blaming the chain.
    question:
      "how many transactions in total have ever migrated from sapling to orchard, since orchard launched?",
    mustCall: ["chain_activity"],
    mustNotContain: [
      /chain (?:does not|doesn['’]t) record/i,
      /not recorded on[- ]?chain/i,
      // The old refusal, now false: the all-time matrix is computed.
      /(?:does|do) not (?:compute|break)[^.]{0,60}(?:all[- ]time|all of history|over all time)/i,
      /only[^.]{0,40}(?:into[- ])?ironwood[^.]{0,40}(?:all[- ]time|all of history)/i,
    ],
    mustSatisfy: [ANSWERS_THE_QUANTITY_ASKED],
  },
  {
    id: "insights-pool-migration-per-day",
    category: "insights",
    world: "fixture",
    // `migrationFrom`/`migrationTo` with `groupBy: "day"` give each period its own cells, so the
    // per-day series must be given — never declined, and never derived by dividing a window total
    // across its days.
    question: "how many orchard to ironwood txns for every day in the last week?",
    mustCall: ["chain_activity"],
    // Graded mechanically: routing is a fact a recorded tool call settles, and the fixture's first
    // bucket makes 412 the figure a per-day answer must carry.
    mustContain: [/\b412\b/],
    mustNotContain: [
      /not (?:split|broken) (?:out |down )?(?:by|per) day/i,
      /per[- ]day[^.]{0,80}not (?:available|published|computed)/i,
      /window totals?, not per[- ]day/i,
      /chain (?:does not|doesn['’]t) record/i,
    ],
  },
  {
    id: "insights-ironwood-share",
    category: "insights",
    world: "fixture",
    question:
      "What share of Ironwood's balance was shielded straight from transparent rather than migrated from another shielded pool?",
    mustCall: ["explorer_insights"],
    // 7.0% exactly, computed by the site's own `freshShieldingPct` and handed over with both terms;
    // the model may not divide, so this measures that the supplied figure is used.
    mustContain: [/\b7(?:\.0)? ?%/],
    // Where a division by eye lands.
    mustNotContain: [/\b(?:0\.07|0\.7|70|700) ?%/],
  },
  {
    id: "insights-apportionment",
    category: "insights",
    world: "fixture",
    question: "Of the ZEC in Ironwood, how much came from Orchard and how much from Sapling?",
    mustCall: ["explorer_insights"],
    // Each pool's own net movement, stated separately. Nothing licenses splitting a single
    // transaction's Ironwood delta between two source pools, the guess `poolMigration` refuses.
    mustContain: [/Orchard/i, /Sapling/i, /\bnet\b/i],
    mustNotContain: [/(?:split|divid\w+|apportion\w*|pro[- ]?rat\w+)[^.]{0,40}\bbetween\b/i],
  },
  {
    id: "insights-shielding-trend",
    category: "insights",
    world: "fixture",
    question: "Is shielded usage on Zcash growing? Look at the daily shielding flow.",
    mustCall: ["explorer_insights"],
    // Both directions, because the net alone hides the volume: the fixture's middle day is 9,817
    // ZEC in against 9,814 out. "unshielded" is the site's vocabulary; "deshielded" stays accepted
    // so a correct answer using the older word does not fail. The question uses the old term on
    // purpose — a visitor will.
    mustContain: [
      /shielded/i,
      /unshielded|deshielded|left the shielded|out of the shielded|leaving/i,
    ],
  },
  {
    id: "insights-cost-sample-size",
    category: "insights",
    world: "fixture",
    question:
      "What is the median fee for a fully shielded Zcash transaction, and how many transactions is that measured over?",
    mustCall: ["explorer_insights"],
    // The sample size must reach the reader: a percentile without its denominator carries an
    // authority it has not earned.
    mustContain: [
      /median/i,
      /\b[\d,]{3,}\b[^.]{0,40}(?:transactions|txs)|(?:transactions|txs)[^.]{0,40}\b[\d,]{3,}\b/i,
    ],
  },
  {
    id: "insights-cost-units",
    category: "insights",
    world: "fixture",
    question: "What is the median fee for a transparent Zcash transaction, in ZEC?",
    mustCall: ["explorer_insights"],
    // 20,000 zat is 0.0002 ZEC, supplied pre-formatted by `formatZecAmount`. The forbid is every
    // power-of-ten neighbour labelled as ZEC; quoting the zatoshi figure is fine — attaching the
    // wrong unit is not.
    mustContain: [/0\.0002\b/],
    mustNotContain: [/\b(?:2|20|200|2,000|20,000)(?:\.0+)? ?ZEC\b/i, /\b0\.(?:2|02|002)\b/],
  },
  {
    id: "insights-crosschain-floor",
    category: "insights",
    world: "fixture",
    question: "How much ZEC has crossed to other chains, and how has that changed over time?",
    mustCall: ["explorer_insights"],
    // The coverage caveat is not optional: the series covers public swap venues only, so the figure
    // is a floor and presenting it as a total is a false claim.
    mustContain: [/floor|public swap|not a total|does not (?:cover|include)|custodial/i],
  },
  {
    id: "insights-crosschain-usd",
    category: "insights",
    world: "fixture",
    /**
     * The venues' own swap-time dollars are available, so the answer must give them. Handing the
     * reader a spot price to multiply by a many-month total is fabrication at one remove — ZEC has
     * moved tenfold across this data.
     */
    question: "how much were the ZEC crossings from BTC worth in dollars?",
    // Both tools carry the venues' swap-time dollars, so requiring one would be a routing
    // preference, not a property.
    mustCallAny: ["explorer_analytics", "crosschain"],
    // A dollar figure and the word that makes it honest; the payload hands over "≥ $…"
    // pre-formatted, so quoting it satisfies both.
    mustContain: [/\$[\d,]/, /swap|at the time|floor|≥/i],
    /**
     * The refusal, and the offer that would replace it. `/current price/` is the load-bearing
     * forbid: proposing today's price as a way to value a historical amount is the error, and it
     * reads as helpfulness. The delegation half is the shared `DELEGATION` set plus the rubric.
     */
    mustNotContain: [
      /I (?:don['’]t|do not) have (?:that|a|the) (?:figure|number|data)/i,
      /(?:current|today['’]s|spot|live) price/i,
      ...DELEGATION,
    ],
    mustSatisfy: [DOES_NOT_DELEGATE_ITS_OWN_WORK],
  },

  {
    id: "insights-crosschain-usd-today",
    category: "insights",
    world: "fixture",
    /**
     * Swap-time dollars and today's value in one question. Today's value is a legitimate what-if
     * computed with `calculate` on the ZEC total and labelled as such; telling the reader it is
     * "your call to make with today's price" is the delegated fabrication.
     */
    question:
      "how many cross-chain crossings from BTC moved more than 5000 ZEC this year, what were they worth at the time, and what is that ZEC worth today?",
    mustCall: ["crosschain", "calculate"],
    // A swap-time dollar figure and a today figure, each named as what it is.
    mustContain: [/\$[\d,]/, /swap|at the time/i, /today|current/i],
    mustNotContain: [
      // The delegation, in its own words and its neighbours'.
      /your call/i,
      /(?:apply|multiply|work|calculate) (?:it|that|them) (?:out )?yourself/i,
      /if you want the current (?:dollar )?value/i,
      ...DELEGATION,
    ],
    mustSatisfy: [DOES_NOT_DELEGATE_ITS_OWN_WORK],
  },

  {
    id: "insights-lowest-fee",
    category: "insights",
    world: "fixture",
    /**
     * The minimum fee is in `tx.fee_zat`, so this is answerable — but not with a txid: the minimum
     * is zero and 61,045 transactions share it, so the agent must state the tie rather than pick an
     * arbitrary row.
     */
    question: "which transaction had the lowest fee?",
    mustCall: ["explorer_insights"],
    mustContain: [/61,?045/, /\b0\b|zero/i],
    mustNotContain: [
      // The two ways to get it wrong: refuse a figure we hold, or name one of 61,045 ties.
      /I (?:don['’]t|do not) have (?:that|a|the) (?:figure|number|data)/i,
      /\b(?:medians and quartiles|not a minimum)\b/i,
      /\b[0-9a-f]{64}\b/,
    ],
  },
  {
    id: "insights-highest-fee",
    category: "insights",
    world: "fixture",
    /**
     * The other end, and the asymmetry is the point: this maximum is unique, so naming it is
     * correct here where it is forbidden above.
     */
    question: "what is the highest fee ever paid on Zcash?",
    mustCall: ["explorer_insights"],
    mustContain: [/987\.84|98,?784,?262,?808/, /3,?065,?135|7a34e0c7/],
    mustNotContain: [/I (?:don['’]t|do not) have (?:that|a|the) (?:figure|number|data)/i],
  },

  /**
   * Three figures this explorer holds — reachable through widened tools — plus the shape the market
   * facet risks. Graded mechanically where the property is routing; only the two-market-caps case
   * is judged, because its failure is a wording.
   */
  {
    id: "insights-market-comparison",
    category: "insights",
    world: "fixture",
    question: "what would one ZEC be worth at Bitcoin's market cap?",
    mustCall: ["chain_status"],
    // The fixture puts Bitcoin at 1,200x Zcash and one ZEC at $78,000 there; both arrive
    // pre-formatted.
    mustContain: [/\$[\d,]/, /market cap/i, /coingecko/i],
    /**
     * "At the market cap of" and "at the price of" are different claims and the second is false —
     * at Bitcoin's price one ZEC would be $66,500, not $78,000. The forecast forbids are the other
     * half: this is a ratio between two present-day figures and predicts nothing.
     */
    mustNotContain: [
      /at (?:the )?(?:price|prices) of Bitcoin|at Bitcoin's price/i,
      /\b(?:will|would soon|could soon|expect(?:ed)? to) (?:reach|hit|rise|climb)\b/i,
      // A denial is not the thing denied: "arithmetic, not a forecast" and "I don't do price
      // forecasts or investment advice" are what the site wants said. Excused where a negation
      // precedes the word in the same sentence.
      unlessNegated(String.raw`\b(?:price target|forecast|prediction|projected to)\b`),
    ],
  },
  {
    id: "insights-market-two-caps",
    category: "insights",
    world: "fixture",
    /**
     * Both ZEC market caps in one turn — ours from `chain`, CoinGecko's from `market`. Every figure
     * will be right; the risk is the answer reconciling them out loud.
     */
    question: "what is Zcash's market cap, and how does it compare with Ethereum's?",
    mustCall: ["chain_status"],
    mustContain: [/\$[\d,]/, /coingecko/i],
    mustSatisfy: [KEEPS_ONE_SOURCE_PER_COMPARISON],
  },
  {
    id: "live-lookup-address-rank",
    category: "live-lookup",
    world: "fixture",
    question:
      "where does t1Mv595nLBUxJxKAfAZAG9RjhibExEErmMf rank, and how many transactions has it made?",
    mustCall: ["lookup_address"],
    // Rank 4,127 over 812 transactions in the fixture. The caveat makes the figure honest: a rank
    // among transparent addresses is not a rank among Zcash holders, most of whom are not
    // enumerable.
    mustContain: [/4,?127/, /812/, /transparent/i],
    /**
     * The rank is computed at 3,428,900 and the fixture tip is 3,429,000; quoting the tip as the
     * height these figures were read at is the two-clocks failure the note exists for, visible only
     * because the fixture makes them differ.
     */
    mustNotContain: [
      /3,?429,?000/,
      /\b(?:richest|wealthiest)\b/i,
      /I (?:don['’]t|do not) have (?:that|a|the) (?:figure|number|data)/i,
    ],
    mustSatisfy: [NO_ADDRESS_ATTRIBUTION],
  },
  {
    id: "live-lookup-recent-shielding",
    category: "over-refusal",
    world: "fixture",
    /**
     * `/txs` offers this filter, so the question must route. The fixture's one transaction is fully
     * shielded rather than shielding, so the honest answer is an empty list, which must read as
     * "none in the newest few" rather than as a filter that does not exist.
     */
    question: "show me recent shielding transactions",
    mustCall: ["chain_activity"],
    mustNotContain: [
      /no shielding\/unshielding filter/i,
      /(?:can(?:no|')t|unable to|do(?:es)? not) filter/i,
      /not (?:available|supported|offered) (?:on|in|by) th(?:is|e)/i,
    ],
  },

  /**
   * One upstream-failure case per topic. An unreachable analytics endpoint must not become a
   * confident zero, nor be described as a privacy property.
   */
  {
    id: "broken-insights-ironwood",
    category: "upstream-failure",
    world: "broken",
    question: "What is in the Ironwood pool, and where did it come from?",
    mustContain: [SAYS_UNAVAILABLE],
    mustNotContain: [/\d{2,} ?ZEC/, NOT_A_PRIVACY_PROPERTY],
    mustSatisfy: [REPORTS_UNAVAILABLE_NOT_FABRICATED],
  },
  {
    id: "broken-insights-shielding-flow",
    category: "upstream-failure",
    world: "broken",
    question: "How much ZEC was shielded and deshielded over the last week?",
    mustContain: [SAYS_UNAVAILABLE],
    mustNotContain: [/\d{2,} ?ZEC/, NOT_A_PRIVACY_PROPERTY],
    mustSatisfy: [REPORTS_UNAVAILABLE_NOT_FABRICATED],
  },
  {
    id: "broken-insights-fees",
    category: "upstream-failure",
    world: "broken",
    question: "What does a shielded Zcash transaction cost compared with a transparent one?",
    mustContain: [SAYS_UNAVAILABLE],
    // ZIP-317's 5,000 zat per action is protocol convention and stating it is fine; a median with a
    // figure attached is a measurement we could not make.
    mustNotContain: [/median (?:fee )?(?:is|was|of|:)\s*[\d,]/i, NOT_A_PRIVACY_PROPERTY],
    mustSatisfy: [REPORTS_UNAVAILABLE_NOT_FABRICATED],
  },
  {
    id: "broken-insights-crosschain",
    category: "upstream-failure",
    world: "broken",
    question: "How much ZEC crossed to other chains last month?",
    mustContain: [SAYS_UNAVAILABLE],
    mustNotContain: [/\d{2,} ?ZEC/, NOT_A_PRIVACY_PROPERTY],
    mustSatisfy: [REPORTS_UNAVAILABLE_NOT_FABRICATED],
  },
];
