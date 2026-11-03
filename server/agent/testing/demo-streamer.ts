import type { ChatStreamer, CompletionParams, StreamEvent } from "../chat-client";

/**
 * A scripted stand-in for the model, for trying the chart feature on a laptop: no key, no network,
 * nothing leaves the machine. It picks a `make_chart` call by keyword, then answers from what the
 * tool returned — the summary of a chart, or the words of a refusal — so the demo's sentence and
 * chart come from the same data. Never used in production; `demo-server.ts` is its only caller
 * besides its test.
 */

const pool = (p: string, metric = "balance") => ({ family: "pool", pool: p, metric });

/** Windows are relative ("90d", "1y") or early enough for both the fixture and the real data. */
const CHART_BY_KEYWORD: readonly { match: RegExp; args: Record<string, unknown> }[] = [
  { match: /hash ?rate/i, args: { series: [{ family: "hashrate" }], range: "1y" } },
  { match: /address|wallet/i, args: { series: [{ family: "address" }] } },
  {
    match: /bitcoin.*week|btc.*week/i,
    args: { series: [{ family: "crosschain", direction: "in", chain: "BTC" }], range: "30d" },
  },
  {
    match: /bitcoin|btc|swap|cross/i,
    args: {
      series: [
        { family: "crosschain", direction: "in", chain: "BTC" },
        { family: "crosschain", direction: "in", chain: "ETH" },
      ],
      range: "1y",
    },
  },
  { match: /price/i, args: { series: [{ family: "price" }], range: "1y" } },
  {
    match: /median/i,
    args: { series: [{ family: "fees", stat: "median", kind: "shielded" }], range: "90d" },
  },
  {
    match: /fee/i,
    args: { series: [{ family: "fees", stat: "total" }], range: "90d", type: "area" },
  },
  {
    match: /miner|concentration/i,
    args: {
      series: [
        { family: "mining", metric: "top1-share" },
        { family: "mining", metric: "top3-share" },
      ],
      range: "all",
    },
  },
  {
    match: /difficulty/i,
    args: { series: [{ family: "mining", metric: "difficulty" }], range: "90d" },
  },
  {
    match: /notes|anonymity/i,
    args: { series: [pool("sapling", "notes"), pool("orchard", "notes")], range: "all" },
  },
  { match: /migrat/i, args: { series: [pool("ironwood", "migrated-in")], from: "2026-07-01" } },
  {
    match: /transactions?\b/i,
    args: {
      series: [
        { family: "transactions", kind: "transparent" },
        { family: "transactions", kind: "mixed" },
        { family: "transactions", kind: "shielded" },
      ],
      range: "1y",
    },
  },
  {
    match: /sprout|log/i,
    args: { series: [pool("sprout"), pool("sapling")], range: "1y", scale: "log" },
  },
  {
    match: /supply/i,
    args: {
      series: [
        { family: "supply", part: "shielded" },
        { family: "supply", part: "transparent" },
      ],
      range: "all",
    },
  },
];

const DEFAULT_CHART = { series: [pool("orchard"), pool("ironwood")], from: "2026-07-01" };

/** Whether a question is one the demo answers with a chart. */
const CHART_WORTHY =
  /chart|graph|plot|drain|compare|trend|over time|since|vs\b|history|week|month|year/i;

const done = (toolCalls: { id: string; name: string; arguments: string }[] = []): StreamEvent => ({
  type: "done",
  finishReason: toolCalls.length > 0 ? "tool_calls" : "stop",
  toolCalls,
  usage: { promptTokens: 0, completionTokens: 0 },
});

/** The last thing the user asked, and the tool results since. */
function turnOf(params: CompletionParams): { question: string; results: string[] } {
  const lastUser = params.messages.map((m) => m.role).lastIndexOf("user");
  const question = String(params.messages[lastUser]?.content ?? "");
  const results = params.messages
    .slice(lastUser + 1)
    .flatMap((m) => (m.role === "tool" ? [m.content] : []));
  return { question, results };
}

/** One sentence per series, from the summary the tool returned: the demo never invents a figure. */
function describe(result: string): string {
  const refusal = result.match(/<refusal[^>]*>\n([^\n]*)/)?.[1];
  if (refusal !== undefined) return `No chart for that: ${refusal}.`;
  const json = result.match(/<data[^>]*>[\s\S]*?(\[[\s\S]*\])\s*<\/data>/)?.[1];
  if (json === undefined) return `I could not draw that: ${result.replace(/\s+/g, " ").trim()}`;
  const rows = JSON.parse(json) as {
    series: string;
    first: { period: string; value: string };
    last: { period: string; value: string };
  }[];
  return rows
    .map(
      (r) =>
        `${r.series} went from ${r.first.value} (${r.first.period}) to ${r.last.value} (${r.last.period}).`,
    )
    .join(" ");
}

export const demoStreamer: ChatStreamer = async function* (params) {
  const { question, results } = turnOf(params);
  if (results.length === 0 && CHART_WORTHY.test(question) && params.tools.length > 0) {
    const args = CHART_BY_KEYWORD.find((k) => k.match.test(question))?.args ?? DEFAULT_CHART;
    yield { type: "content", text: "Charting that from the explorer's own series." };
    yield done([{ id: "demo-1", name: "make_chart", arguments: JSON.stringify(args) }]);
    return;
  }
  const text =
    results.length > 0
      ? describe(results[results.length - 1]!)
      : "This is the local demo: it answers chart questions only. Try “how did Orchard drain since July?”, “chart the price this year”, “Bitcoin swaps over the year”, “miner concentration history” or “compare transactions over time”.";
  yield { type: "content", text };
  yield done();
};
