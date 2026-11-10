import type { EvalCase } from "./types";

/**
 * Published series Zeno reads: all-time records, the mining terms, the node map, per-pool usage
 * with each pool's anonymity set, and pool balances over time — including an all-history per-pool
 * count, which takes an open window. Fixture figures are production payloads captured into
 * `testing/__fixtures__/v1-published-series.json`, so every asserted number is a real one.
 */
export const PUBLISHED_SERIES: EvalCase[] = [
  {
    id: "pools-usage-all-history",
    category: "insights",
    world: "fixture",
    question: "how many transactions has each shielded pool had since launch?",
    mustCall: ["chain_activity"],
    mustNotContain: [
      /temporarily unavailable|not finished building|not available (?:at the moment|right now)/i,
    ],
  },
  {
    id: "pools-anonymity-set",
    category: "insights",
    world: "fixture",
    question: "how big was the Orchard anonymity set at the end of July 2026?",
    mustCall: ["chain_activity"],
    mustContain: [/50,?281,?176|50\.28 ?million/],
  },
  {
    id: "pools-notes-added",
    category: "insights",
    world: "fixture",
    /*
     * The growth is published as `notes.created`, equal to Orchard's action count: quoted, never
     * worked out from two tree sizes, and never a total over pools.
     */
    question: "how many notes were added to the Orchard pool last month?",
    mustCall: ["chain_activity"],
    mustContain: [/126,?717/],
    mustNotContain: [/50,?154,?459/],
  },
  {
    id: "orchard-share-migrated",
    category: "insights",
    world: "fixture",
    /*
     * The share has one stated denominator, Orchard before NU6.3. The forbid is the share taken
     * against Ironwood's balance instead (736,000 of 825,000).
     */
    question: "what share of Orchard has migrated to Ironwood so far?",
    mustCall: ["explorer_insights"],
    mustContain: [/18\.4\s?%/, /4,?000,?000|before (?:NU6\.3|activation)/i],
    mustNotContain: [/89\.2\s?%/],
  },
  {
    id: "orchard-remaining",
    category: "insights",
    world: "fixture",
    question: "how much ZEC is left in the Orchard pool after the migration to Ironwood started?",
    mustCall: ["explorer_insights"],
    mustContain: [/3,?180,?000/],
  },
  {
    id: "pool-balances-monthly",
    category: "insights",
    world: "fixture",
    question: "what did the Sapling pool hold at the end of January 2026?",
    mustCall: ["chain_activity"],
    mustContain: [/618,?554/],
  },
  {
    id: "records-highest-fee",
    category: "insights",
    world: "fixture",
    question: "what is the highest fee ever paid by a single Zcash transaction?",
    mustCall: ["chain_status"],
    mustContain: [/987\.8/],
  },
  {
    id: "nodes-count-and-country",
    category: "insights",
    world: "fixture",
    /*
     * The count is a floor, and a correct answer says so: only nodes that accept connections can be
     * crawled. The forbid is the advertised-address total stated as the node count.
     */
    question: "how many Zcash nodes are there, and which country has the most?",
    mustCall: ["chain_status"],
    mustContain: [
      /153/,
      /United States/,
      /at least|accept(?:s|ing)? (?:incoming )?connections|behind (?:a )?router|larger|undercount/i,
    ],
    mustNotContain: [/5,?2\d\d (?:zcash )?nodes/i],
  },
  {
    id: "mining-solution-rate",
    category: "insights",
    world: "fixture",
    /* Equihash yields solutions, not hashes: a figure in H/s is a category error. */
    question: "what is the Zcash network hashrate right now?",
    mustCall: ["chain_status"],
    mustContain: [/27(?:\.1\d?|,146)/],
    mustNotContain: [/\d\s*[KMGTP]?H\/s/],
  },
  {
    id: "nodes-history-upgrade-pace",
    category: "insights",
    world: "fixture",
    /**
     * The software record by release line, `chain_status` 'node-history'. In the fixture, Zakura
     * 1.4 falls from 9 answering nodes on the first recorded day to 1 on the newest, as nodes move
     * to 1.5 and 1.6.
     */
    question: "how has the number of nodes running Zakura 1.4 changed since you began recording?",
    mustCall: ["chain_status"],
    mustContain: [/Zakura 1\.4|1\.4/, /\b9\b/, /\b1\b/],
  },
  {
    id: "nodes-history-hosting",
    category: "insights",
    world: "fixture",
    /**
     * The hosting record: DigitalOcean hosts the most answering nodes every day of the fixture, 16
     * of 40 on the newest. A network under three nodes that day is folded, never named.
     */
    question:
      "which network hosts the most Zcash nodes, and has that changed over the last two weeks?",
    mustCall: ["chain_status"],
    mustContain: [/DigitalOcean/, /\b16\b/],
  },
  {
    id: "exchange-reserves-binance-month",
    category: "insights",
    world: "fixture",
    /*
     * The figures are the fixture world's (`reserveFixture`): Binance's five labelled addresses on
     * 2026-08-03, and their change from July's close. The answer must say it is the labelled
     * addresses only, never Binance's holdings.
     */
    question:
      "how much ZEC does Binance hold on its labelled transparent addresses, and how did it change this month?",
    mustCall: ["chain_activity"],
    mustContain: [/120,?491/, /653/, /label/i],
  },
  {
    id: "exchange-reserves-not-holdings",
    category: "insights",
    world: "fixture",
    question: "how much ZEC does Kraken hold right now?",
    mustCall: ["chain_activity"],
    mustContain: [/label/i],
    mustNotContain: [/Kraken(?:'s)? (?:total )?holdings? (?:is|are|of)/i],
  },
  {
    id: "coin-age-dormant",
    category: "insights",
    world: "fixture",
    /*
     * The figure is the newest block's 5-years-or-more band. The forbids are the two misreadings
     * the note warns about: an output read as a holder, and an unmoved coin read as a lost one.
     */
    question: "how much transparent ZEC has not moved in five years or more?",
    mustCall: ["chain_activity"],
    mustContain: [/940,?755|940\.8 ?(?:thousand|K)|941(?:,000| ?thousand|K)/i, /16\.8\d? ?%/],
    mustNotContain: [
      /long-term holders?|(?<!not |n't |never )\b(?:are|were|is) (?:probably |likely )?lost\b/i,
    ],
  },
  {
    id: "coin-age-month-end",
    category: "insights",
    world: "fixture",
    question: "at the end of March 2026, how much transparent ZEC was less than a week old?",
    mustCall: ["chain_activity"],
    mustContain: [/30,?624/],
  },
];
