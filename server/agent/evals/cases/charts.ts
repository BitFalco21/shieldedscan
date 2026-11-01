import type { EvalCase } from "./types";

/**
 * Charts: drawn when change over time or a comparison is the question, or when asked for; never for
 * a single figure. Graded on the `chart` events the reader receives (`mustChart` / `mustNotChart`),
 * not on the tool being called, since a refused call draws nothing.
 *
 * Fixture cases run on the pinned clock (2026-08-03), where Ironwood activated on 2026-07-28 and
 * Orchard drains into it. Live cases need the private API (`EVAL_CHAIN_BASE_URL`,
 * `EVAL_CHAIN_TOKEN`); without it every chart source answers 503 and the chart cases fail, which
 * is the honest result.
 */

/** A markdown table: the chart redrawn in text, which the prompt forbids beside a chart. */
const TABLE_ROW = /^\s*\|.*\|.*\|\s*$/m;

export const CHARTS: EvalCase[] = [
  {
    id: "charts-orchard-drain",
    category: "charts",
    world: "fixture",
    question: "How did the Orchard pool drain since July?",
    mustCall: ["make_chart"],
    mustChart: true,
    mustContain: [/Orchard/i],
    mustNotContain: [TABLE_ROW],
  },
  {
    id: "charts-compare-pools",
    category: "charts",
    world: "fixture",
    question: "Compare the Ironwood and Orchard balances since July 2026.",
    mustCall: ["make_chart"],
    mustChart: true,
    mustContain: [/Ironwood/i, /Orchard/i],
    mustNotContain: [TABLE_ROW],
  },
  {
    id: "charts-explicit-request",
    category: "charts",
    world: "fixture",
    question: "chart the ZEC price since 2026-07-26",
    mustCall: ["make_chart"],
    mustChart: true,
    mustNotContain: [TABLE_ROW],
  },
  {
    // Two measures of very different scale: the tool refuses them on one axis, so a good answer is
    // two charts (or one and words). Graded on a chart appearing at all.
    id: "charts-two-measures",
    category: "charts",
    world: "fixture",
    question: "Plot the ZEC price and the Orchard balance since 2026-07-26 on one chart.",
    mustCall: ["make_chart"],
    mustChart: true,
  },
  {
    id: "charts-live-orchard-90d",
    category: "charts",
    world: "live",
    question: "How has the Orchard pool balance changed over the last 90 days?",
    mustCall: ["make_chart"],
    mustChart: true,
    mustNotContain: [TABLE_ROW],
  },
  {
    id: "charts-live-fees-month-vs-last",
    category: "charts",
    world: "live",
    question: "fees this month vs last month",
    mustCall: ["make_chart"],
    mustChart: true,
  },
  {
    id: "charts-not-for-shielded-supply",
    category: "charts",
    world: "live",
    question: "What is the shielded supply?",
    mustCallAny: ["chain_status", "chain_activity"],
    mustNotChart: true,
  },
  {
    id: "charts-not-for-current-price",
    category: "charts",
    world: "live",
    question: "What's the ZEC price right now?",
    mustCall: ["chain_status"],
    mustNotChart: true,
  },
  {
    id: "charts-not-for-a-concept",
    category: "charts",
    world: "live",
    question: "What is the Ironwood pool?",
    mustContain: [/Ironwood/i],
    mustNotChart: true,
  },
];
