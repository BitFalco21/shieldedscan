/**
 * The chart library's single source of truth.
 *
 * Every chart on /charts — and its detail page at /charts/[slug] — comes from this list, so
 * the gallery, the routes, the sitemap additions and the e2e sweep can never disagree about
 * what exists. A chart is metadata here and rendering in `ChartFigure`; the two are keyed by
 * the same slug, and an entry without a renderer fails loudly at build time via the switch's
 * exhaustiveness.
 *
 * The description is the chart's honest frame, in the same register as the /analytics prose:
 * what is measured, from where, and the one way a reader is most likely to misread it. Every
 * chart on this site plots only genuinely public data, and several descriptions say so
 * explicitly because that IS the product.
 */

import { NU7 } from "@/domain";
import { isTestnet } from "@/lib/network";

export type ChartSlug =
  | "transactions-by-kind"
  | "shielding-flow"
  | "median-fee"
  | "pool-balances"
  | "pool-usage"
  | "pool-migrations"
  | "shielded-supply"
  | "ironwood-balance"
  | "price"
  | "difficulty"
  | "block-size"
  | "fee-totals"
  | "crosschain-volume"
  | "privacy-share"
  | "anonymity-set"
  | "fee-spread"
  | "blocks-per-day"
  | "transparent-activity"
  | "upgrade-readiness"
  | "miner-concentration"
  | "reorgs"
  | "inflow-by-chain";

/** The library's filter chips, in display order. A chart sits in exactly one. */
export const CHART_CATEGORIES = [
  "Privacy",
  "Supply",
  "Activity",
  "Fees",
  "Mining",
  "Network & nodes",
  "Cross-chain",
  "Market",
] as const;

export type ChartCategory = (typeof CHART_CATEGORIES)[number];

export interface ChartEntry {
  slug: ChartSlug;
  title: string;
  category: ChartCategory;
  /**
   * The public endpoint serving this chart's series, and its entry on /api-docs. A chart a reader
   * cannot fetch would be a claim they cannot check, so null is reserved for a series the public
   * API does not carry yet, and the chart's page says so.
   */
  api: { docsId: string; path: string } | null;
  /** The day the chart joined the library, `YYYY-MM-DD`: the gallery marks it new for a while. */
  added?: string;
  /** One line for the gallery card. */
  blurb: string;
  /** The detail page's frame: measurement, source, and the likeliest misreading. */
  description: string[];
}

export const CHARTS: ChartEntry[] = [
  {
    slug: "shielded-supply",
    title: "Total shielded supply",
    category: "Supply",
    api: { docsId: "analytics-pools", path: "/v1/analytics/pools" },
    blurb: "ZEC held across all four shielded pools, daily since 2016.",
    description: [
      "Every ZEC sitting inside Sprout, Sapling, Orchard or Ironwood, read from the chain's own value-pool accounting at each day's final block. This is the closest thing Zcash has to a headline privacy metric: value inside a pool is encrypted on-chain, so this line is the size of the crowd everything shielded hides in.",
      "The total is public even though the contents are not — every transaction crossing a pool boundary declares a net value, and the pools' totals are consensus data. Nothing here estimates what moves inside a pool.",
    ],
  },
  {
    slug: "pool-balances",
    title: "Where shielded value sits",
    category: "Supply",
    api: { docsId: "analytics-pools", path: "/v1/analytics/pools" },
    blurb: "The four pools' balances, month by month.",
    description: [
      "Each shielded pool's closing balance per month. The pools tell Zcash's protocol history: Sprout (2016) drained after its cryptography aged, Sapling (2018) carried the middle years, Orchard (2022) took over, and Ironwood (2026) is filling through a turnstile designed to contain a disclosed Orchard soundness risk.",
      "Balances are read at each month's final block — a pool can fall within a month, so an average would not be a balance at any moment that existed.",
    ],
  },
  {
    slug: "pool-usage",
    title: "Which pools get used",
    category: "Privacy",
    api: { docsId: "analytics-pool-usage", path: "/v1/analytics/pool-usage" },
    blurb: "Transactions touching each shielded pool per day, since 2016.",
    description: [
      "How many transactions carried each pool's cryptography, day by day — the protocol's history told in usage rather than balances: Sprout fading out, Sapling's middle years, Orchard's takeover, Ironwood's adoption since NU6.3.",
      "The four lines are deliberately not stacked and do not sum to the day's transaction total: one transaction can carry two pools' bundles — a migration uses both its source and its destination — and using a pool is not shielding: a fully shielded transfer inside one pool counts too. Sprout's presence is measured from its JoinSplits, a different accounting than the other pools' bundles.",
    ],
  },
  {
    slug: "pool-migrations",
    title: "Value migrating between pools",
    category: "Privacy",
    api: { docsId: "migrations", path: "/v1/analytics/migrations" },
    blurb: "ZEC crossing from one shielded pool into another, daily.",
    description: [
      "Fully shielded transactions where exactly one pool gained value — the amount is the destination pool's own published value balance, public by construction, so the bands partition each day's migrated total honestly. The Ironwood band since NU6.3 (block 3,428,143) is the turnstile draining Orchard.",
      "A transaction where two pools gain is refused rather than apportioned, the same rule the transaction page applies — how much went where would be a guess. Sprout's outbound side derives from its public JoinSplit values.",
    ],
  },
  {
    slug: "shielding-flow",
    title: "Shielded in and out",
    category: "Privacy",
    api: { docsId: "shielding-flow", path: "/v1/analytics/shielding-flow" },
    blurb: "Gross ZEC entering and leaving the shielded pools, monthly.",
    description: [
      "Both directions of the privacy boundary, drawn to one shared scale — the net is the visible gap between the bars. Net alone hides the story: a month with 10,000 ZEC shielded and 9,900 unshielded nets to almost nothing, yet nearly 20,000 ZEC crossed the boundary.",
      "Summed from each transaction's own declared value balances, Sprout included. Pool-to-pool migrations net out by construction, so Ironwood's activation does not masquerade as a shielding wave.",
    ],
  },
  {
    slug: "ironwood-balance",
    title: "Ironwood pool balance",
    category: "Supply",
    api: { docsId: "analytics-ironwood", path: "/v1/analytics/ironwood" },
    blurb: "The fourth pool's balance, hourly since NU6.3 activation.",
    description: [
      "Zcash's newest shielded pool, hourly from its activation at block 3,428,143 (2026-07-28). Hourly because the window is days old — a daily series would be a handful of points drawn as a trend nobody measured.",
      "The pool did not exist before the series starts, so there is nothing earlier to show. Not everything arriving here is the Orchard turnstile: a measurable share is fresh shielding straight from transparent addresses — see the breakdown on the shielded pools page.",
    ],
  },
  {
    slug: "transactions-by-kind",
    title: "Transactions by privacy kind",
    category: "Activity",
    api: { docsId: "monthly", path: "/v1/analytics/monthly" },
    blurb: "Monthly transactions: transparent, mixed, fully shielded.",
    description: [
      "Every month since launch, split by how much of each transaction is shielded: fully transparent, mixed (one side shielded), or fully shielded. Coinbase transactions are excluded — one per block regardless of anyone's choices, and counting them would quietly deflate the shielded share.",
      "The counts are public by construction: they come from transaction structure, not from anything the encryption protects.",
    ],
  },
  {
    slug: "median-fee",
    title: "Median fee by privacy kind",
    category: "Fees",
    api: { docsId: "analytics-fees", path: "/v1/analytics/fees" },
    blurb: "What a transaction costs — shielded is the cheap option.",
    description: [
      "The median fee per month for each privacy kind. Measured over the recent chain, a fully shielded transaction's median fee is half a transparent one's: ZIP-317 prices logical actions, and a transparent transaction sweeping many coins carries more of them than a two-action shielded spend. Privacy is not the expensive option on Zcash.",
      "Medians, never averages — the fee distribution is heavy-tailed, and a single fat-fingered 987 ZEC fee would otherwise bend an entire year. A month where a kind has no median is drawn as a gap, never as zero.",
    ],
  },
  {
    slug: "fee-totals",
    title: "Total fees paid",
    category: "Fees",
    api: { docsId: "activity", path: "/v1/analytics/activity" },
    blurb: "What the whole network pays in fees — miner revenue beyond the block subsidy.",
    description: [
      "The sum of every fee paid, per period. Deliberately not the same question as the median-fee chart: that one asks what a single transaction costs, which is set by ZIP-317 and barely moves, while this is fee count multiplied by fee size and rises and falls with demand. A reader who conflated the two would conclude the network's fee income is flat.",
      "This is the part of a miner's income that does not come from the block subsidy. It is small next to the subsidy today, which is the honest headline: Zcash's security budget is still overwhelmingly issuance, and the halving schedule means that fees will have to grow for that to change.",
      "Each period carries the number of blocks behind it and how many of them had a derivable fee total. A block's total is legitimately unknown when a transaction in it has an input we could not resolve — coverage is complete today and is not guaranteed to stay so, and a total quoted over an unstated denominator is the failure this site exists to avoid.",
    ],
  },
  {
    slug: "crosschain-volume",
    title: "Cross-chain volume",
    category: "Cross-chain",
    api: { docsId: "crosschain-aggregate", path: "/v1/crosschain/aggregate" },
    blurb: "ZEC arriving and leaving through public swap venues, on one shared scale.",
    description: [
      "ZEC crossing between Zcash and other chains, drawn in both directions against a single ruler so the gap between the bars is the net flow. The cross-chain page shows all-time totals and an all-time diagram; this is the same data over time, which is what answers whether bridging is growing or shrinking.",
      "It covers public swap protocols only — Maya Protocol, THORChain and NEAR Intents. Custodial routes leave no public per-transfer record: an exchange withdrawal is a real crossing that no venue publishes, so none of it is here. Aggregators are excluded because they settle on these same venues and counting them would double every figure. So the real totals are higher than every number shown.",
      "Wrapped ZEC counts as a crossing. Minting a synthetic claim on another chain moves value off Zcash whether or not anyone calls it a bridge.",
    ],
  },
  {
    slug: "price",
    title: "ZEC price",
    category: "Market",
    api: { docsId: "prices", path: "/v1/prices/daily" },
    blurb: "Daily USD close since launch.",
    description: [
      "One close per day since October 2016. There is no canonical daily ZEC price — sources aggregating different venues disagree by a couple of percent on the same day — so each stored close carries its source, and the series was verified against a real exchange's traded closes where that history exists.",
      "This is the one chart on the site whose data does not come from the Zcash chain. It is here because fees and volumes are priced with it — at their own dates, never today's.",
    ],
  },
  {
    slug: "difficulty",
    title: "Mining difficulty",
    category: "Mining",
    api: { docsId: "analytics-network", path: "/v1/analytics/network" },
    blurb: "Daily average difficulty since launch.",
    description: [
      "The proof-of-work difficulty, averaged per day from every block's own header. Rising difficulty means more Equihash solution power securing the chain; the long shape tracks hardware generations and price cycles.",
      "Note the y-axis spans orders of magnitude across a decade — the early chain is a flat line not because nothing happened but because 2016 difficulty is invisible at 2026 scale.",
    ],
  },
  {
    slug: "block-size",
    title: "Block size",
    category: "Mining",
    api: { docsId: "analytics-network", path: "/v1/analytics/network" },
    blurb: "Daily average block size — block-space utilisation.",
    description: [
      "Average block size per day, against a consensus cap of 2 MB. This is the direct measure of block-space demand.",
      "Read it carefully: a low line means no congestion, not no usage. Zcash blocks arrive on a fixed target interval whether full or nearly empty, and most carry kilobytes. The honest claim this chart supports is that block space is plentiful — fees stay at the ZIP-317 convention because nobody needs to outbid anyone.",
    ],
  },
  {
    slug: "privacy-share",
    title: "Share of transactions by privacy kind",
    category: "Privacy",
    api: { docsId: "monthly", path: "/v1/analytics/monthly" },
    added: "2026-10-09",
    blurb: "Fully shielded, mixed and transparent, as shares of each period.",
    description: [
      "The share of each period's transactions that were fully shielded, mixed (crossing the shielded boundary) or fully transparent. Coinbase transactions are left out, so the three shares sum to 100% of the rest.",
      "A share is only as meaningful as its count, so the readout states how many transactions each point is a share of. Fully shielded is a share of transactions, not of value.",
    ],
  },
  {
    slug: "anonymity-set",
    title: "Anonymity set per pool",
    category: "Privacy",
    api: { docsId: "analytics-pool-usage", path: "/v1/analytics/pool-usage" },
    added: "2026-10-09",
    blurb: "Notes in each pool's commitment tree: what a shielded spend hides among.",
    description: [
      "Each shielded pool keeps a tree of every note ever created in it, spent or not. A spend proves its note is somewhere in that tree without saying where, so the tree's size is the crowd the spend hides in.",
      "Pools are drawn separately and never added: a spend hides only among its own pool's notes. The node does not report Sprout's tree size, so Sprout is not drawn.",
    ],
  },
  {
    slug: "fee-spread",
    title: "Fee spread by privacy kind",
    category: "Fees",
    api: { docsId: "analytics-fees", path: "/v1/analytics/fees" },
    added: "2026-10-09",
    blurb: "The middle half of fees paid, p25 to p75, around each median.",
    description: [
      "For each privacy kind, the shaded band runs from the 25th to the 75th percentile of the fees paid in the period, with the median drawn through it: half of all fee-paying transactions paid within the band.",
      "Percentiles are computed per period and never averaged across periods. The readout gives how many transactions each kind's figures rest on.",
    ],
  },
  {
    slug: "blocks-per-day",
    title: "Blocks per day",
    category: "Mining",
    api: { docsId: "analytics-network", path: "/v1/analytics/network" },
    added: "2026-10-09",
    blurb: "Blocks mined each day, against the protocol's target.",
    description: [
      "Blocks mined per complete UTC day. The dashed line is the protocol's target: 576 a day at the original 150-second block time, 1,152 since Blossom halved it to 75 seconds in December 2019. The activation day falls under both targets and shows none.",
      "Difficulty adjusts to keep blocks near the target, so a lasting gap means hash rate moved faster than the adjustment. The current day is left out until it ends.",
    ],
  },
  {
    slug: "transparent-activity",
    title: "Transparent activity",
    category: "Activity",
    api: { docsId: "analytics-transparent", path: "/v1/analytics/transparent" },
    added: "2026-10-09",
    blurb: "Distinct transparent addresses active each day, since 2016.",
    description: [
      "How many distinct transparent addresses sent or received ZEC each UTC day. A distinct count does not add across days: an address active on two days is counted once on each.",
      "The readout adds the ZEC paid to transparent outputs that day. It includes change returned to the sender, so it bounds the value that changed hands from above. Shielded activity has no address and is in neither figure.",
    ],
  },
  {
    slug: "upgrade-readiness",
    title: `${NU7.name} readiness`,
    category: "Network & nodes",
    api: null,
    added: "2026-10-09",
    blurb: "Answering nodes ready for the next network upgrade, day by day.",
    description: [
      `The share of the nodes the crawler reached each day that run a release able to follow ${NU7.name}, the share declaring its protocol version, and the share behind this explorer's tip.`,
      "Counts are floors: the crawler reaches only nodes that accept incoming connections, so the network is larger. Each day is the network as it stood at that day's last crawl.",
    ],
  },
  {
    slug: "miner-concentration",
    title: "Largest miners' share of blocks",
    category: "Mining",
    api: { docsId: "analytics-miners", path: "/v1/analytics/miners" },
    added: "2026-10-09",
    blurb: "Share of each month's blocks paid to the top 1, 3 and 10 addresses.",
    description: [
      "Each month's blocks, grouped by the payout address of the coinbase's largest output, which is the miner by consensus. The lines are the share of all the month's blocks paid to the largest address, the largest three and the largest ten.",
      "Addresses are never merged, so an operator paid at several addresses counts as several: every share is a lower bound for any operator. The denominator is every block, shielded-coinbase and unrecorded ones included.",
    ],
  },
  {
    slug: "reorgs",
    title: "Reorganisations observed",
    category: "Network & nodes",
    api: { docsId: "reorgs-list", path: "/v1/reorgs" },
    added: "2026-10-09",
    blurb: "Chain rollbacks this explorer's node saw, week by week.",
    description: [
      "How many reorganisations this explorer's own node observed each week, with the deepest of the week. Depth-1 reorgs are routine on proof of work.",
      "One node's record from the day it began watching, not a census of the network: a block orphaned and replaced between two polls is never seen, and no week before observation began is drawn.",
    ],
  },
  {
    slug: "inflow-by-chain",
    title: "Inflow by source chain",
    category: "Cross-chain",
    api: { docsId: "crosschain-aggregate", path: "/v1/crosschain/aggregate" },
    added: "2026-10-09",
    blurb: "ZEC arriving on Zcash each month, by the chain it came from.",
    description: [
      "ZEC arriving through the public swap venues this explorer indexes, by the chain the swap started on, month by month. The largest sources are drawn on their own and the rest grouped.",
      "Swaps through venues not indexed here are not counted, so every figure is a lower bound.",
    ],
  },
];

/**
 * Charts that cannot tell the truth on testnet, and are therefore absent there rather than
 * empty, like `/donate` and the `/cross-chain` subtree:
 *
 * - `crosschain-volume`: the cross-chain pollers are network-blind, so the testnet database
 *   holds mainnet swaps, which would render as TAZ.
 * - `price`: TAZ has no price, so the panel would be a titled shell with no geometry.
 * - `inflow-by-chain`: read from the same network-blind cross-chain store as `crosschain-volume`.
 * - `upgrade-readiness`: it measures mainnet readiness, and its source page 404s on testnet.
 *
 * Gated here because the catalogue is the single source the gallery, routes, sitemap and e2e
 * sweep all read.
 */
const MAINNET_ONLY_CHARTS: ReadonlySet<ChartSlug> = new Set([
  "crosschain-volume",
  "price",
  "inflow-by-chain",
  "upgrade-readiness",
]);

/** The charts this deployment may honestly show. */
export const VISIBLE_CHARTS: ChartEntry[] = isTestnet
  ? CHARTS.filter((c) => !MAINNET_ONLY_CHARTS.has(c.slug))
  : CHARTS;

export function chartBySlug(slug: string): ChartEntry | undefined {
  return VISIBLE_CHARTS.find((c) => c.slug === slug);
}

/**
 * Up to `count` other charts to read next: the same category first, then the categories nearest
 * it in `CHART_CATEGORIES` order, each in catalogue order. Deterministic, so a chart's page always
 * suggests the same neighbours.
 */
export function relatedCharts(slug: ChartSlug, count = 3): ChartEntry[] {
  const self = chartBySlug(slug);
  if (!self) return [];
  const home = CHART_CATEGORIES.indexOf(self.category);
  const distance = (c: ChartEntry) => Math.abs(CHART_CATEGORIES.indexOf(c.category) - home);
  return VISIBLE_CHARTS.filter((c) => c.slug !== slug)
    .map((c, order) => ({ c, order }))
    .sort((a, b) => distance(a.c) - distance(b.c) || a.order - b.order)
    .slice(0, count)
    .map(({ c }) => c);
}

/** How long a chart is marked new in the library after it joins. */
const NEW_FOR_SECONDS = 45 * 86_400;

/** Whether a chart joined the library recently enough to be marked new at `nowSec`. */
export function isNewChart(chart: ChartEntry, nowSec: number): boolean {
  if (!chart.added) return false;
  const added = Date.parse(`${chart.added}T00:00:00Z`) / 1000;
  return nowSec >= added && nowSec - added < NEW_FOR_SECONDS;
}
