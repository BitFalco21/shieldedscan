import type { ToolResult } from "./types";

/**
 * A chart the tool will not draw, said so it can be passed on usefully: why (a closed reason the
 * model can phrase), the closest chart the tool CAN draw as ready-made arguments, and the `/charts`
 * page to open, which the reader gets as a source link beneath the answer, so the model never has
 * to write a link itself.
 */

export const CHART_REFUSAL_REASONS = [
  /** Outside every family: hashrate, an asset, a TVL. */
  "not-chartable",
  /** Per-address history: refused on purpose, no linkability tooling. */
  "per-address",
  /** A value outside its list, a missing parameter, an unknown argument. */
  "bad-parameter",
  /** Parameters that name no series (Sprout's note tree, a chain not listed). */
  "names-nothing",
  /** Two measures on one axis. */
  "mixed-measures",
  /** Transactions split by pool and by kind on one chart. */
  "split",
  "too-many-series",
  /** Before launch, in the future, empty, or too short to be a chart. */
  "window",
  /** A daily source keeps a year; the window is older. */
  "reach",
  /** A series kept per month, asked over less than two months. */
  "monthly-only",
  /** One series under 1/50 of another on a linear axis. */
  "spread",
  /** A log axis over a series that is zero there. */
  "log-zero",
  /** Nothing measured in that window. */
  "no-data",
  /** A source could not be read just now. */
  "unavailable",
  /** The answer already carries the most charts one answer may. */
  "chart-limit",
] as const;
export type ChartRefusalReason = (typeof CHART_REFUSAL_REASONS)[number];

export interface ChartRefusal {
  reason: ChartRefusalReason;
  message: string;
  /** Argument sets the tool can draw instead, nearest first. */
  closest?: Record<string, unknown>[];
  /** `/charts/<slug>` pages that show the nearest thing, cited beneath the answer. */
  pages?: string[];
}

/** The citation a refusal's page travels as; `sourceLinkFor` turns it into `/charts/<slug>`. */
export const CHART_PAGE_SOURCE = "chart-page:";

const ADVICE =
  "Say in words why there is no chart. Name the closest chart you can draw — and draw it if it answers the question — and point the reader at the page linked beneath your answer. Never describe a chart that was not drawn, and give no figure the tool did not return.";

export function refusalResult(r: ChartRefusal): ToolResult {
  const pages = [...new Set(r.pages ?? [])];
  const lines = [
    r.message,
    ...(r.closest ?? []).map((args) => `closest: make_chart ${JSON.stringify(args)}`),
    ...pages.map((slug) => `page: /charts/${slug}`),
    ADVICE,
  ];
  return {
    content: `<refusal source="chart" reason="${r.reason}">\n${lines.join("\n")}\n</refusal>`,
    endpoints: pages.map((slug) => `${CHART_PAGE_SOURCE}${slug}`),
  };
}

const ADDRESS_LIKE = /\b(t1|t3|zs1|u1|tex1)[0-9a-z]{20,}/i;

/**
 * The nearest chart for a request outside the families, judged from the words in its arguments:
 * a wrong guess costs a suggestion, never a figure.
 */
export function closestForUnknown(args: Record<string, unknown>): ChartRefusal | null {
  const text = JSON.stringify(args).toLowerCase();
  if (
    ADDRESS_LIKE.test(text) ||
    /"(address|wallet|holder|account)"|\baddress\b|holder|wallet/.test(text)
  ) {
    return {
      reason: "per-address",
      message:
        "per-address history is not charted, on purpose: this explorer builds no tooling that follows one address over time",
    };
  }
  const hint = (
    re: RegExp,
    message: string,
    closest: Record<string, unknown>,
    page: string,
  ): ChartRefusal | null =>
    re.test(text)
      ? { reason: "not-chartable", message, closest: [{ series: [closest] }], pages: [page] }
      : null;
  return (
    hint(
      /hash.?rate|hash.?power|sol\/s|solps/,
      "there is no hashrate series; difficulty moves with it",
      { family: "mining", metric: "difficulty" },
      "difficulty",
    ) ??
    hint(
      /nsm|issu|unclaimed|burn|max.?supply|total.?supply|mined.?supply/,
      "issuance and the NSM are figures, not series here; the supply parts are",
      { family: "supply", part: "circulating" },
      "shielded-share",
    ) ??
    hint(
      /p90|p75|p25|percentile|quartile|average|mean/,
      "only the median fee is kept per day; quartiles are a recent figure in words",
      { family: "fees", stat: "median", kind: "transparent" },
      "median-fee",
    ) ??
    hint(
      /asset|token|usdc|usdt|stablecoin/,
      "cross-chain flows are kept by chain and by venue, not by asset",
      { family: "crosschain", direction: "in", by: "total" },
      "crosschain-volume",
    ) ??
    hint(
      /shielded.?in|unshielded.?out/,
      "shielding is measured across all pools, not per pool",
      { family: "shielding", direction: "in" },
      "shielding-flow",
    )
  );
}
