import type { EvalCase } from "./types";

/**
 * Common questions, each with the round trips a well-routed answer needs.
 *
 * A round trip to the model costs seconds of first-token wait, so the cheapest speed-up is not
 * making one. Each case names the tool that answers it directly (`mustCallAny`), the detours a wrong
 * route takes (`mustNotCall`), and the most tool rounds before the answer (`maxToolRounds`): one
 * for a figure a single lookup carries, two only where a second step is genuinely needed — a date to
 * fetch before a price, or a sum the data does not carry.
 *
 * Live: a real-model run reads today's chain. The `route` is the ideal first round, used by the
 * scripted model and by `latency-routes.test.ts`, which dispatches it against the fixture world.
 *
 * Real identifiers only: a transaction from a recorded mainnet block, a labelled exchange address,
 * and a block height past Ironwood's activation.
 */

const REAL_TXID = "51c8140f08383384b5c1c9b4832387f3bacfb4b831f8e9e7c7c67a2780d3fbb2";
const LABELLED_ADDRESS = "t1Mv595nLBUxJxKAfAZAG9RjhibExEErmMf";

const status = (...include: string[]) => ({ name: "chain_status" as const, args: { include } });

export const LATENCY: readonly EvalCase[] = [
  // ── the tip, the price, the last 24 hours ────────────────────────────────────────────────
  {
    id: "latency-tip",
    category: "latency",
    world: "live",
    question: "What is the current block height?",
    mustCallAny: ["chain_status"],
    maxToolRounds: 1,
    route: [status("chain")],
    routeCarries: ["height"],
  },
  {
    id: "latency-price",
    category: "latency",
    world: "live",
    question: "What is the price of ZEC right now?",
    mustCallAny: ["chain_status"],
    mustNotCall: ["zec_price_history"],
    maxToolRounds: 1,
    route: [status("chain")],
    routeCarries: ["priceUsd"],
  },
  {
    id: "latency-market-cap",
    category: "latency",
    world: "live",
    question: "What is Zcash's market cap?",
    mustCallAny: ["chain_status"],
    mustNotCall: ["calculate"],
    maxToolRounds: 1,
    route: [status("chain")],
    routeCarries: ["marketCapUsd"],
  },
  {
    // Measured live at 15–35 s over 2–5 calls (period totals, then sums) before the rolling count
    // was named where the model looks for it.
    id: "latency-tx-24h",
    category: "latency",
    world: "live",
    question: "How many transactions were there in the last 24 hours?",
    mustCallAny: ["chain_status"],
    mustNotCall: ["chain_activity", "calculate"],
    maxToolRounds: 1,
    route: [status("chain")],
    routeCarries: ["txCount24h", "txCount24hGrouped"],
  },
  {
    id: "latency-shielded-share-24h",
    category: "latency",
    world: "live",
    question: "What share of Zcash transactions in the last 24 hours were fully shielded?",
    mustCallAny: ["chain_status"],
    mustNotCall: ["chain_activity", "calculate"],
    maxToolRounds: 1,
    route: [status("chain")],
    routeCarries: ["fullyShieldedPct24h", "txCount24h"],
  },
  // ── pools and supply ─────────────────────────────────────────────────────────────────────
  {
    id: "latency-orchard-now",
    category: "latency",
    world: "live",
    question: "How much ZEC is in the Orchard pool right now?",
    mustCallAny: ["chain_status"],
    mustNotCall: ["chain_activity"],
    maxToolRounds: 1,
    route: [status("supply")],
    routeCarries: ["balanceZec"],
  },
  {
    id: "latency-shielded-supply-usd",
    category: "latency",
    world: "live",
    question: "How much ZEC is shielded in total, and what is that worth in dollars?",
    mustCallAny: ["chain_status"],
    mustNotCall: ["calculate"],
    maxToolRounds: 1,
    route: [status("supply")],
  },
  {
    id: "latency-compare-pools-now",
    category: "latency",
    world: "live",
    question: "Compare the Orchard and Ironwood pool balances right now.",
    mustCallAny: ["chain_status"],
    maxToolRounds: 1,
    route: [status("supply")],
  },
  {
    id: "latency-mined-left",
    category: "latency",
    world: "live",
    question: "How much ZEC has been mined so far, and how much is left to mine?",
    mustCallAny: ["chain_status"],
    mustNotCall: ["calculate"],
    maxToolRounds: 1,
    route: [status("supply")],
    routeCarries: ["minedZat"],
  },
  {
    id: "latency-pool-over-time",
    category: "latency",
    world: "live",
    question: "How did the Sapling pool's balance change month by month this year?",
    mustCallAny: ["chain_activity", "make_chart"],
    maxToolRounds: 1,
    route: [
      {
        name: "chain_activity",
        args: { mode: "pool-balances", from: "2026-01-01", to: "2026-08-01", groupBy: "month" },
      },
    ],
  },
  {
    id: "latency-chart-orchard",
    category: "latency",
    world: "live",
    question: "Chart the Orchard pool balance over the last year.",
    mustCall: ["make_chart"],
    mustChart: true,
    maxToolRounds: 1,
    route: [
      {
        name: "make_chart",
        args: { series: [{ family: "pool", pool: "orchard", metric: "balance" }], range: "1y" },
      },
    ],
  },
  // ── activity over a period ───────────────────────────────────────────────────────────────
  {
    id: "latency-tx-last-week",
    category: "latency",
    world: "live",
    question: "How many transactions were there in the last 7 days?",
    mustCallAny: ["chain_activity"],
    mustNotCall: ["calculate"],
    maxToolRounds: 1,
    route: [{ name: "chain_activity", args: { mode: "window", lastDays: 7 } }],
  },
  {
    id: "latency-shielded-last-month",
    category: "latency",
    world: "live",
    question: "How many fully shielded transactions were there last month?",
    mustCallAny: ["chain_activity"],
    mustNotCall: ["calculate"],
    maxToolRounds: 1,
    route: [
      { name: "chain_activity", args: { mode: "window", from: "2026-07-01", to: "2026-08-01" } },
    ],
  },
  {
    id: "latency-busiest-day",
    category: "latency",
    world: "live",
    question: "Which day this year had the most transactions?",
    mustCallAny: ["chain_activity"],
    mustNotCall: ["calculate"],
    maxToolRounds: 1,
    route: [
      {
        name: "chain_activity",
        args: {
          mode: "window",
          from: "2026-01-01",
          to: "2026-08-01",
          groupBy: "day",
          sort: "transactions",
          top: 1,
        },
      },
    ],
  },
  {
    id: "latency-miners",
    category: "latency",
    world: "live",
    question: "Who mined the most blocks in the last 30 days?",
    mustCallAny: ["chain_activity"],
    maxToolRounds: 1,
    route: [{ name: "chain_activity", args: { mode: "miners", lastDays: 30 } }],
  },
  {
    id: "latency-mining-pool-share",
    category: "latency",
    world: "live",
    question: "What share of blocks did ViaBTC mine over the last 30 days?",
    mustCallAny: ["chain_activity"],
    maxToolRounds: 1,
    route: [{ name: "chain_activity", args: { mode: "mining-pools", lastDays: 30 } }],
    routeCarries: ["pools"],
  },
  {
    id: "latency-nsm",
    category: "latency",
    world: "live",
    question: "How much ZEC went to the NSM this week, and what is its balance?",
    mustCallAny: ["chain_activity"],
    maxToolRounds: 1,
    route: [{ name: "chain_activity", args: { mode: "nsm", lastDays: 7 } }],
    routeCarries: ["balance", "toNsm"],
  },
  // ── protocol figures ─────────────────────────────────────────────────────────────────────
  {
    id: "latency-halving",
    category: "latency",
    world: "live",
    question: "At what height is the next halving, and how many blocks are left until it?",
    mustCallAny: ["chain_status"],
    mustNotCall: ["calculate"],
    maxToolRounds: 1,
    route: [status("halving")],
  },
  {
    id: "latency-reward-split",
    category: "latency",
    world: "live",
    question:
      "How is the block reward split right now between the miner, the funding streams and the lockbox?",
    mustCallAny: ["chain_status"],
    mustNotCall: ["calculate"],
    maxToolRounds: 1,
    route: [status("halving")],
  },
  {
    id: "latency-mining-terms",
    category: "latency",
    world: "live",
    question: "What is the current difficulty and network solution rate?",
    mustCallAny: ["chain_status"],
    maxToolRounds: 1,
    route: [status("mining")],
  },
  {
    id: "latency-fee-typical",
    category: "latency",
    world: "live",
    question: "What does a typical Zcash transaction pay in fees?",
    mustCallAny: ["explorer_insights", "chain_status"],
    maxToolRounds: 1,
    route: [{ name: "explorer_insights", args: { topic: "transaction-costs" } }],
  },
  {
    // A worked example may not cover four actions, and then the product is a genuine second step.
    id: "latency-zip317-fee",
    category: "latency",
    world: "live",
    question: "What is the conventional ZIP-317 fee for a transaction with 4 logical actions?",
    mustCallAny: ["chain_status"],
    maxToolRounds: 2,
    route: [status("fees")],
  },
  {
    id: "latency-record-fee",
    category: "latency",
    world: "live",
    question: "What is the highest fee ever paid by a single transaction?",
    mustCallAny: ["chain_status", "explorer_insights"],
    maxToolRounds: 1,
    route: [status("records")],
  },
  {
    id: "latency-nodes",
    category: "latency",
    world: "live",
    question: "How many Zcash nodes are there on the network?",
    mustCallAny: ["chain_status"],
    maxToolRounds: 1,
    route: [status("nodes")],
  },
  {
    id: "latency-mempool",
    category: "latency",
    world: "live",
    question: "How busy is the mempool right now?",
    mustCallAny: ["explorer_analytics"],
    maxToolRounds: 1,
    route: [{ name: "explorer_analytics", args: { series: "mempool" } }],
  },
  // ── price history ────────────────────────────────────────────────────────────────────────
  {
    id: "latency-price-ath",
    category: "latency",
    world: "live",
    question: "What was ZEC's highest price ever?",
    mustCallAny: ["zec_price_history"],
    maxToolRounds: 1,
    route: [{ name: "zec_price_history", args: { days: 7 } }],
  },
  {
    // The halving's day must be read before its close can be: two rounds is the floor here.
    id: "latency-price-on-halving",
    category: "latency",
    world: "live",
    question: "What was ZEC's price on the day of the last halving?",
    mustCall: ["chain_status", "zec_price_history"],
    maxToolRounds: 2,
    route: [status("halving")],
  },
  // ── one entity ───────────────────────────────────────────────────────────────────────────
  {
    id: "latency-address",
    category: "latency",
    world: "live",
    question: `What is the balance of ${LABELLED_ADDRESS}?`,
    mustCall: ["lookup_address"],
    maxToolRounds: 1,
    route: [{ name: "lookup_address", args: { address: LABELLED_ADDRESS } }],
  },
  {
    id: "latency-transaction",
    category: "latency",
    world: "live",
    question: `What pools did transaction ${REAL_TXID} use, and what fee did it pay?`,
    mustCall: ["lookup_transaction"],
    maxToolRounds: 1,
    route: [{ name: "lookup_transaction", args: { txid: REAL_TXID } }],
  },
  {
    id: "latency-block",
    category: "latency",
    world: "live",
    question: "How many transactions are in block 3428150, and who mined it?",
    mustCall: ["lookup_block"],
    maxToolRounds: 1,
    route: [{ name: "lookup_block", args: { heightOrHash: "3428150" } }],
  },
  // ── cross-chain ──────────────────────────────────────────────────────────────────────────
  {
    id: "latency-crosschain-btc",
    category: "latency",
    world: "live",
    question: "How much ZEC came from Bitcoin to Zcash in the last 30 days?",
    mustCall: ["crosschain"],
    mustNotCall: ["calculate"],
    maxToolRounds: 1,
    route: [
      {
        name: "crosschain",
        args: { mode: "aggregate", chain: "BTC", direction: "in", lastDays: 30 },
      },
    ],
  },
  // ── reference, ZIPs, the site ────────────────────────────────────────────────────────────
  {
    id: "latency-zips",
    category: "latency",
    world: "live",
    question: "What are ZIP 317 and ZIP 2005, and what status does each have?",
    mustCall: ["zip_index"],
    maxToolRounds: 1,
    route: [{ name: "zip_index", args: { zip: [317, 2005] } }],
  },
  {
    id: "latency-ceremony",
    category: "latency",
    world: "live",
    question: "How many people took part in the Sapling trusted-setup ceremony?",
    mustCall: ["zcash_reference"],
    maxToolRounds: 1,
    route: [{ name: "zcash_reference", args: { topic: "ceremonies" } }],
  },
  {
    id: "latency-api-limits",
    category: "latency",
    world: "live",
    question: "What are the rate limits on your public API?",
    mustCall: ["site_guide"],
    maxToolRounds: 1,
    route: [{ name: "site_guide", args: { section: "api" } }],
  },
  {
    id: "latency-export",
    category: "latency",
    world: "live",
    question: "Can I download the ZEC price for the last 30 days as a CSV?",
    mustCall: ["export_data"],
    mustExport: true,
    maxToolRounds: 1,
    route: [{ name: "export_data", args: { family: "price", range: "30d" } }],
  },
  // ── several figures at once: one round of parallel lookups ──────────────────────────────
  {
    id: "latency-parallel",
    category: "latency",
    world: "live",
    question:
      "How many transactions were there in the last 24 hours, and what did ZEC close at each day this past week?",
    mustCall: ["chain_status", "zec_price_history"],
    mustNotCall: ["chain_activity", "calculate"],
    maxToolRounds: 1,
    route: [status("chain"), { name: "zec_price_history", args: { days: 7 } }],
  },
];
