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

import { NU7, REISSUANCE_START_HEIGHT } from "@/domain";
import { formatCount } from "@/lib/format";
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
  | "orchard-migration"
  | "price"
  | "difficulty"
  | "block-arrival-age"
  | "block-size"
  | "fee-totals"
  | "crosschain-volume"
  | "privacy-share"
  | "anonymity-set"
  | "notes-added"
  | "blocks-per-day"
  | "transparent-activity"
  | "upgrade-readiness"
  | "miner-concentration"
  | "node-hosting"
  | "node-releases"
  | "reorgs"
  | "orphan-rate"
  | "inflow-by-chain"
  | "outflow-by-chain"
  | "volume-by-venue"
  | "shielded-capable-swaps"
  | "shielded-share"
  | "supply-issuance"
  | "pools-to-majority"
  | "shielded-capable-by-chain"
  | "issuance-vs-nsm";

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
    slug: "supply-issuance",
    title: "Supply issuance",
    category: "Supply",
    api: null,
    blurb: "ZEC issued so far, and the schedule's path toward the 21M cap.",
    description: [
      "Issued ZEC at each day's closing block, then the issuance schedule projected to the sixth halving. Issued is what the schedule has paid out through a block: the six value pools plus the NSM balance add up to it to the zatoshi.",
      `Heights in the projection are consensus; their dates are estimates at the observed block rate. From block ${formatCount(REISSUANCE_START_HEIGHT)} blocks also pay out part of the NSM balance (ZIP 237); that ZEC is already counted here, so the total is unchanged.`,
    ],
  },
  {
    slug: "issuance-vs-nsm",
    title: "Issuance vs NSM removals",
    category: "Supply",
    api: { docsId: "nsm", path: "/v1/analytics/nsm" },
    blurb: "ZEC issued each day since NU7, and what the NSM removed.",
    description: [
      "Per complete UTC day since NU7: the ZEC the day's blocks issued under the subsidy schedule, funding streams included, and the 60% of their fees ZIP 235 moved into the NSM. Issued less removed is the day's net new ZEC; the readout gives it.",
      "Drawn on a log scale, because removals are a small fraction of issuance: on a plain scale they would be a flat line at zero.",
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
    slug: "shielded-share",
    title: "Share of ZEC held shielded",
    category: "Supply",
    api: null,
    blurb: "Shielded ZEC as a share of circulating supply, every day since 2016.",
    description: [
      "Every shielded pool's balance at each day's last block, as a share of circulating ZEC at the same block: all mined ZEC except the dev-fund lockbox. A pool counts as empty before it existed.",
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
    slug: "orchard-migration",
    title: "Orchard migrating to Ironwood",
    category: "Supply",
    api: { docsId: "analytics-ironwood", path: "/v1/analytics/ironwood" },
    blurb: "ZEC moved from Orchard into Ironwood since NU6.3, and what Orchard still holds.",
    description: [
      "Since NU6.3 opened Ironwood at block 3,428,143 (2026-07-28), Orchard value migrates into it. One line is the ZEC migrated from Orchard into Ironwood so far, as Ironwood received it; the other is Orchard's balance at each day's last block.",
      "The share is everything migrated as a percent of Orchard's balance at block 3,428,142, the block before activation. Orchard also shrinks by unshielding, fees and migrations into other pools, so the two lines need not add up. A migration drawing on two or more pools at once is left out, never split.",
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
      "The readout gives the blocks each total covers. If a block's fees could not be read, it says how many of the period's blocks the total rests on and marks it partial.",
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
    slug: "block-arrival-age",
    title: "Block age on arrival, by mining pool",
    category: "Mining",
    api: { docsId: "mining-pools-arrival", path: "/v1/analytics/mining-pools/arrival" },
    blurb: "How old each pool's blocks are, by their own timestamp, when our node stores them.",
    description: [
      "Each UTC day's median and 90th percentile of the time from a block's header timestamp to the moment this explorer's node first stored it, for every block and per mining pool. Measured by our own follower since it began stamping blocks.",
      "Not clock skew: it adds up the miner's timestamp lag (a pool stamps a block template and keeps mining on it), propagation to our node and our own 5 to 10 seconds; mostly the first differs by pool, though propagation can too. A negative age is a pool's clock ahead of ours. Blocks stored more than ten minutes late, almost always during our own outages, are left out and counted.",
    ],
  },
  {
    slug: "privacy-share",
    title: "Share of transactions by privacy kind",
    category: "Privacy",
    api: { docsId: "monthly", path: "/v1/analytics/monthly" },
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
    blurb: "Notes in each pool's commitment tree: what a shielded spend hides among.",
    description: [
      "Each shielded pool keeps a tree of every note ever created in it, spent or not. A spend proves its note is somewhere in that tree without saying where, so the tree's size is the crowd the spend hides in.",
      "Pools are drawn separately and never added: a spend hides only among its own pool's notes. The node does not report Sprout's tree size, so Sprout is not drawn.",
    ],
  },
  {
    slug: "notes-added",
    title: "Notes added per pool",
    category: "Privacy",
    api: { docsId: "analytics-pool-usage", path: "/v1/analytics/pool-usage" },
    blurb: "How fast each pool's anonymity set grows: notes created per day or month.",
    description: [
      "The notes each pool's commitment tree gained in a period, monthly over all history and daily for shorter ranges. Every Sapling output and every Orchard or Ironwood action creates one note, so this is also the pool's output or action count.",
      "Pools are drawn separately and never added: a spend hides only among its own pool's notes. The node does not report Sprout's tree, so Sprout is not drawn.",
    ],
  },
  {
    slug: "blocks-per-day",
    title: "Blocks per day",
    category: "Mining",
    api: { docsId: "analytics-network", path: "/v1/analytics/network" },
    blurb: "Blocks mined each day, against the protocol's target.",
    description: [
      "Blocks mined per complete UTC day. The dashed line is the protocol's target: 576 a day at the original 150-second block time, 1,152 since Blossom halved it to 75 seconds in December 2019, and 3,456 from NU7's 25 seconds. An activation day falls under two targets and shows none.",
      "Difficulty adjusts to keep blocks near the target, so a lasting gap means hash rate moved faster than the adjustment. The current day is left out until it ends.",
    ],
  },
  {
    slug: "transparent-activity",
    title: "Transparent activity",
    category: "Activity",
    api: { docsId: "analytics-transparent", path: "/v1/analytics/transparent" },
    blurb: "Distinct transparent addresses active each day, since 2016.",
    description: [
      "How many distinct transparent addresses sent or received ZEC each UTC day. A distinct count does not add across days: an address active on two days is counted once on each.",
      "Shielded activity has no address, so it is not counted here.",
    ],
  },
  {
    slug: "upgrade-readiness",
    title: `${NU7.name} readiness`,
    category: "Network & nodes",
    api: null,
    blurb: "Answering nodes ready for the next network upgrade, day by day.",
    description: [
      `The share of the nodes the crawler reached each day that run a release able to follow ${NU7.name}, the share declaring its protocol version, and the share behind this explorer's tip.`,
      "Counts are floors: the crawler reaches only nodes that accept incoming connections, so the network is larger. Each day is the network as it stood at that day's last crawl.",
    ],
  },
  {
    slug: "node-releases",
    title: "Node software over time",
    category: "Network & nodes",
    api: { docsId: "nodes-history", path: "/v1/nodes/history" },
    blurb: "Answering nodes by client and release line, day by day.",
    description: [
      "Each day's answering nodes as a share, by the client and major.minor release they declared, from the crawler's daily record: the network as it stood at that day's last crawl. The largest release lines are named and the rest folded.",
      "A user agent is a node's own claim and is not verified. Only nodes that accept incoming connections can be counted, so the network is larger.",
    ],
  },
  {
    slug: "node-hosting",
    title: "Node hosting concentration",
    category: "Network & nodes",
    api: { docsId: "nodes-history", path: "/v1/nodes/history" },
    blurb: "Answering nodes by the network that hosts them, day by day.",
    description: [
      "Each day's answering nodes as a share, by the autonomous system that hosts them as GeoIP names it, recorded by the crawler from the day this chart began. The largest networks are named; a network holding fewer than three nodes that day is folded into the rest, never named.",
      "Grouped by network, never by company: two networks one company runs count apart, so real concentration can only be higher. No node address is published.",
    ],
  },
  {
    slug: "miner-concentration",
    title: "Largest miners' share of blocks",
    category: "Mining",
    api: { docsId: "analytics-miners", path: "/v1/analytics/miners" },
    blurb:
      "Share of each month's blocks paid to the top 1, 3 and 10 addresses, and to shielded ones.",
    description: [
      "Each month's blocks, grouped by the payout address of the coinbase's largest output, which is the miner by consensus once the NU6.1 lockbox disbursement is set aside. The lines are the share of all the month's blocks paid to the largest address, the largest three and the largest ten.",
      "A miner paid to a shielded address cannot be named, so those blocks are drawn as their own line. Addresses are never merged: an operator paid at several counts as several, so every share is a lower bound for any operator.",
    ],
  },
  {
    slug: "reorgs",
    title: "Reorganisations observed",
    category: "Network & nodes",
    api: { docsId: "reorgs-list", path: "/v1/reorgs" },
    blurb: "Chain rollbacks this explorer's node saw, week by week.",
    description: [
      "How many reorganisations this explorer's own node observed each week, with the deepest of the week. Depth-1 reorgs are routine on proof of work.",
      "One node's record from the day it began watching, not a census of the network: a block orphaned and replaced between two polls is never seen, and no week before observation began is drawn.",
    ],
  },
  {
    slug: "orphan-rate",
    title: "Observed orphan rate",
    category: "Network & nodes",
    api: null,
    blurb: "Blocks this explorer's node saw orphaned, per canonical block, daily.",
    description: [
      "Each UTC day's orphaned blocks as a share of its canonical blocks, over the last sixty days, with the rate over standing windows and on either side of NU7. A depth-2 reorg is two orphans. Each orphan is counted on the day of the block it competed with, by header time, so both counts share one clock.",
      "One node's view, so the network's rate can only be higher: a competing block our node never received is not counted. The same node and the same polling since recording began is what makes the before-and-after comparison like with like. NU7 cut the block time from 75 to 25 seconds, which is why the canonical count per day tripled.",
    ],
  },
  {
    slug: "inflow-by-chain",
    title: "Inflow by source chain",
    category: "Cross-chain",
    api: { docsId: "crosschain-aggregate", path: "/v1/crosschain/aggregate" },
    blurb: "ZEC arriving on Zcash each month, by the chain it came from.",
    description: [
      "ZEC arriving through the public swap venues this explorer indexes, by the chain the swap started on, month by month. The largest sources are drawn on their own and the rest grouped.",
      "Swaps through venues not indexed here are not counted, so every figure is a lower bound.",
    ],
  },
  {
    slug: "outflow-by-chain",
    title: "Outflow by destination chain",
    category: "Cross-chain",
    api: { docsId: "crosschain-aggregate", path: "/v1/crosschain/aggregate" },
    blurb: "ZEC leaving Zcash each month, by the chain it went to.",
    description: [
      "ZEC leaving through the public swap venues this explorer indexes, by the chain the swap ended on, month by month. The largest destinations are drawn on their own and the rest grouped.",
      "Swaps through venues not indexed here are not counted, so every figure is a lower bound.",
    ],
  },
  {
    slug: "volume-by-venue",
    title: "Swap volume by venue",
    category: "Cross-chain",
    api: { docsId: "crosschain-aggregate", path: "/v1/crosschain/aggregate" },
    blurb: "ZEC swapped each month through each venue, both directions.",
    description: [
      "ZEC in and out through each public swap venue this explorer indexes, added per month. Both directions count: this is how much each venue carried, not a net flow.",
    ],
  },
  {
    slug: "shielded-capable-swaps",
    title: "Swaps into a shielded-capable address",
    category: "Cross-chain",
    api: { docsId: "destinations", path: "/v1/crosschain/destinations" },
    blurb: "Share of swaps into ZEC each month that went to a Sapling or unified address.",
    description: [
      "Of the swaps into ZEC each month, the share sent to an address that can receive shielded funds: Sapling or unified. Shielded-capable, never shielded: a unified address may also carry a transparent receiver, and which one a payout used is not public.",
      "Drawn by swap count, as the public API states it, and by ZEC. A swap whose venue published no Zcash address is in neither side of either share.",
    ],
  },
  {
    slug: "pools-to-majority",
    title: "Pools needed for 51% of blocks",
    category: "Mining",
    api: { docsId: "mining-pools-series", path: "/v1/analytics/mining-pools/series" },
    blurb: "How many mining pools, largest first, mined a majority of each month's blocks.",
    description: [
      "Each month, how many reviewed mining pools, counted from the largest, mined 51% of all its blocks. Unattributed, shielded-coinbase and unrecorded blocks stay in the month's total, so naming more of them could only lower the count: it is a maximum.",
      "A month in which every reviewed pool together mined less than 51% has no count: the answer would depend on how the rest is split. A pool is this explorer's reviewed label on its payout addresses.",
    ],
  },
  {
    slug: "shielded-capable-by-chain",
    title: "Shielded-capable swaps by source chain",
    category: "Cross-chain",
    api: { docsId: "destinations", path: "/v1/crosschain/destinations" },
    blurb: "Per source chain, the share of swaps into ZEC sent to a Sapling or unified address.",
    description: [
      "For each chain swaps into ZEC came from, the share that went to an address able to receive shielded funds, Sapling or unified, against a transparent one, with the counts. Shielded-capable, never shielded: a unified address may carry a transparent receiver, and which one a payout used is not public.",
      "A swap whose venue published no Zcash address is in neither share and counted beside it. The mix follows the venues: THORChain swaps begin on 2 October 2026, and Maya carried no ZEC from late August to 1 October 2026.",
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
  "outflow-by-chain",
  "volume-by-venue",
  "shielded-capable-swaps",
  "upgrade-readiness",
  // Dated from /halving's schedule, whose heights are mainnet consensus constants.
  "supply-issuance",
  // The NSM series is read from mainnet's NU7 height.
  "issuance-vs-nsm",
  // Until the testnet API carries /chain/reorgs/orphan-rate; remove once it does.
  "orphan-rate",
  // Reviewed pool labels are mainnet payout addresses, and /miners is absent on testnet.
  "pools-to-majority",
  "shielded-capable-by-chain",
  // Its pools are mainnet payout addresses; testnet's blocks would all be unattributed.
  "block-arrival-age",
  // The crawler is mainnet-only.
  "node-releases",
  "node-hosting",
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
