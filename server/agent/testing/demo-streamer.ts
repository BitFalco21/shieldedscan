import type { ChatStreamer, CompletionParams, StreamEvent } from "../chat-client";

/**
 * A scripted stand-in for the model, for trying the chart feature on a laptop: no key, no network,
 * nothing leaves the machine. It picks a `make_chart` call by keyword, then answers from the
 * summary the tool returned, so the demo's sentence and chart come from the same fixture data.
 * Never used in production; `demo-server.ts` is its only caller besides its test.
 */

/** The fixture world's clock is 2026-08-03, so the windows below are set inside its data. */
const CHART_BY_KEYWORD: readonly { match: RegExp; args: Record<string, unknown> }[] = [
  { match: /price/i, args: { series: ["zec-price"], from: "2026-07-26" } },
  { match: /fee/i, args: { series: ["fees-paid"], from: "2026-07-01", type: "area" } },
  { match: /difficulty/i, args: { series: ["difficulty"], range: "90d" } },
  {
    match: /transactions?\b/i,
    args: {
      series: ["transparent-transactions", "mixed-transactions", "fully-shielded-transactions"],
      range: "1y",
    },
  },
  {
    match: /sprout|log/i,
    args: { series: ["sprout-balance", "sapling-balance"], from: "2026-03-01", scale: "log" },
  },
];

const DEFAULT_CHART = { series: ["orchard-balance", "ironwood-balance"], from: "2026-07-01" };

/** Whether a question is one the demo answers with a chart. */
const CHART_WORTHY = /chart|graph|plot|drain|compare|trend|over time|since|vs\b|history/i;

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
      : "This is the local demo: it answers chart questions only. Try “how did Orchard drain since July?”, “chart the price”, “fees vs last month” or “compare transactions over time”.";
  yield { type: "content", text };
  yield done();
};
