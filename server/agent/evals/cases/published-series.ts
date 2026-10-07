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
];
