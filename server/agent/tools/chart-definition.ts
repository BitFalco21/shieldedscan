import {
  CHART_RANGES,
  CROSSCHAIN_BY,
  CROSSCHAIN_MEASURES,
  CROSSCHAIN_PROTOCOLS,
  FEE_STATS,
  FLOW_DIRECTIONS,
  MAX_PLOT_SERIES,
  MINING_METRICS,
  NETWORK_METRICS,
  PLOT_CHAIN_TICKERS,
  PLOT_FAMILIES,
  PLOT_SCALES,
  PLOT_TX_KINDS,
  PLOT_TYPES,
  POOL_METRICS,
  POOL_NAMES,
  SUPPLY_PARTS,
} from "@/domain";

/**
 * `make_chart`'s description and parameters. A series is a flat object of enums, with no `oneOf`,
 * which some providers drop from a schema: which parameters each family takes is in the
 * descriptions, and the server refuses a wrong combination by name.
 */

export const MAKE_CHART_DESCRIPTION =
  // The words a visitor uses for wanting a picture ("chart", "graph", "plot", "trend", "over time",
  // "compare"), and the rule that keeps it from replacing a single figure.
  "Show the reader a CHART beneath your answer, drawn from this explorer's own data — the same series its /charts pages plot. Use it when the question is about CHANGE OVER TIME, a trend, or a COMPARISON across a period ('how did Orchard drain since July', 'compare Ironwood and Orchard balances', 'fees this month vs last', 'Bitcoin to Zcash swaps this year', 'graph the price'), or whenever the reader asks for a chart, graph or plot. NOT for a single figure ('what is the shielded supply') — that is a sentence. You choose only WHAT to plot: up to 3 series of the SAME measure (one axis — two measures are two charts), a window, line or area, linear or log. You never supply a number: this explorer reads every value and returns a short summary you may quote. The grain (daily, weekly, monthly) follows the window. Per-address history is never charted. When the tool refuses, its reply names the closest chart it can draw.";

const FAMILY_GUIDE = [
  "pool: pool + metric (balance | transactions | migrated-in = ZEC migrated into that pool | notes = note tree size, not Sprout)",
  "supply: part (shielded | transparent | lockbox | circulating)",
  "shielding: direction (in = ZEC shielded, out = ZEC unshielded; all pools together)",
  "transactions: kind (transparent | mixed | shielded = fully shielded), or pool instead of kind",
  "fees: stat (total = fees paid | median, which needs kind; median per day, last year only)",
  "mining: metric (blocks | difficulty | top1-share | top3-share | top10-share | shielded-coinbase-share; the shares are per month)",
  "network: metric (block-size | active-addresses = active transparent addresses)",
  "price: no parameters (USD daily close)",
  "crosschain: direction (in = into Zcash | out) + by (total, the default | chain + chain ticker | venue + venue); measure (zec, the default | transfers = swap count, total only). Per chain and per venue it is kept per MONTH only",
].join("; ");

const word = (values: readonly string[], description: string) => ({
  type: "string",
  enum: [...values],
  description,
});

export const MAKE_CHART_PARAMETERS = {
  series: {
    type: "array",
    description: `1 to ${MAX_PLOT_SERIES} series of ONE measure. Each is {family, …its parameters}: ${FAMILY_GUIDE}. Pool balances share an axis with the supply parts; ZEC flows (shielding, migrations, fees paid, cross-chain ZEC) share one; transaction, swap and block counts share one, but never pools beside privacy kinds.`,
    items: {
      type: "object",
      properties: {
        family: word(PLOT_FAMILIES, "Which series family."),
        pool: word(POOL_NAMES, "pool, or transactions per pool."),
        metric: word(
          [...new Set([...POOL_METRICS, ...MINING_METRICS, ...NETWORK_METRICS])],
          "pool, mining or network: which measure.",
        ),
        part: word(SUPPLY_PARTS, "supply only."),
        direction: word(FLOW_DIRECTIONS, "shielding or crosschain."),
        kind: word(PLOT_TX_KINDS, "transactions, or fees median."),
        stat: word(FEE_STATS, "fees only."),
        by: word(CROSSCHAIN_BY, "crosschain only."),
        chain: word(PLOT_CHAIN_TICKERS, "crosschain by chain: the counterpart chain's ticker."),
        venue: word(CROSSCHAIN_PROTOCOLS, "crosschain by venue."),
        measure: word(CROSSCHAIN_MEASURES, "crosschain by total."),
      },
      required: ["family"],
      additionalProperties: false,
    },
  },
  range: {
    type: "string",
    enum: CHART_RANGES.map((r) => r.value),
    description:
      "A trailing window ending today: 30d, 60d, 90d, 180d, 1y, or all (since 2016). Use instead of from/to. Omit both for all.",
  },
  from: {
    type: "string",
    description: "Start of an absolute window, a UTC day as YYYY-MM-DD. Inclusive.",
  },
  to: {
    type: "string",
    description: "End of the window, YYYY-MM-DD, EXCLUSIVE. Only with from; omit to run to today.",
  },
  type: {
    type: "string",
    enum: [...PLOT_TYPES],
    description: "'line' (default) or 'area' (each series filled to zero, never stacked).",
  },
  scale: {
    type: "string",
    enum: [...PLOT_SCALES],
    description:
      "'linear' (default) or 'log', for series of one measure that differ by orders of magnitude (Sprout beside Orchard).",
  },
} as const;
