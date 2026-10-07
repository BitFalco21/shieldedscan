/**
 * The three exchanges the `/mcp` hero shows: a question, the tool call an assistant makes, an
 * excerpt of what the server returned, and an answer built only from that excerpt.
 *
 * The figures are real responses from the live server (read 2026-10-04), each chosen so it
 * cannot go stale: a closed calendar month (September 2026's migrations), a consensus height
 * (the halving at 4,406,400 and its subsidies), and an all-time record (a single transaction's
 * 987.84262808 ZEC fee, unique, so the records endpoint names it). The answer's wording is ours
 * and the page says so; the numbers are what the tool returned.
 */

export interface McpExchange {
  id: string;
  /** Short tab label. */
  topic: string;
  question: string;
  tool: string;
  args: Record<string, string>;
  /** An excerpt of the real response, pretty-printed. */
  excerpt: string;
  answer: string;
}

export const MCP_DEMO: McpExchange[] = [
  {
    id: "migrations",
    topic: "Orchard → Ironwood",
    question: "How much ZEC moved from Orchard into Ironwood in September?",
    tool: "analytics_migrations",
    args: { from: "2026-09-01", to: "2026-10-01", source: "orchard", destination: "ironwood" },
    excerpt: `{
  "source": "orchard",
  "destination": "ironwood",
  "txs": 5382,
  "amountZec": "84095.50612847",
  "value": { "currency": "usd", "amount": "106027593.55" }
}`,
    answer:
      "84,095.50612847 ZEC moved from Orchard into Ironwood in September 2026, across 5,382 migrations: about $106.0 million, each valued at its own day's close.",
  },
  {
    id: "record-fee",
    topic: "Largest fee",
    question: "What is the largest fee ever paid on Zcash?",
    tool: "analytics_records",
    args: {},
    excerpt: `"highest": {
  "amount": { "zec": "987.84262808" },
  "ties": 1,
  "height": 3065135
}`,
    answer: "987.84262808 ZEC, paid by a single transaction in block 3,065,135.",
  },
  {
    id: "halving",
    topic: "Next halving",
    question: "When is the next Zcash halving, and what changes?",
    tool: "network_halving",
    args: {},
    excerpt: `{
  "halvingHeight": 4406400,
  "currentSubsidy": {
    "totalZat": 156250000,
    "minerZat": 125000000
  },
  "nextSubsidy": {
    "totalZat": 78125000,
    "minerZat": 78125000
  }
}`,
    answer:
      "At block 4,406,400, expected in late November 2028. The block subsidy halves from 1.5625 to 0.78125 ZEC, but the funding streams and the lockbox end there too, so the miner's share only falls from 1.25 to 0.78125 ZEC.",
  },
];
