import { POOL_MIGRATION_DESTINATIONS, POOL_MIGRATION_SOURCES, POOL_NAMES } from "@/domain";
import { REFERENCE_TOPIC_NAMES } from "../reference";
import { MAX_ZIP_PICKS, ZIP_SECTION_IDS } from "../zip-index";
import type { ToolName } from "./names";
import {
  ANALYTICS_SERIES,
  CHAIN_ACTIVITY_MODES,
  CHAIN_STATUS_FACETS,
  CROSSCHAIN_DIRECTIONS,
  CROSSCHAIN_GROUP_BY,
  CROSSCHAIN_MODES,
  CROSSCHAIN_RANK_UNITS,
  CROSSCHAIN_SORTS,
  CROSSCHAIN_VENUES,
  DEFAULT_MINER_ROWS,
  DEFAULT_RECENT_ROWS,
  DEFAULT_WINDOW_TOP,
  INSIGHT_TOPICS,
  MAX_CROSSCHAIN_ROWS,
  MAX_EXPRESSIONS_PER_CALL,
  MAX_MINER_ROWS,
  MAX_PRICE_DAY_PICKS,
  MAX_PRICE_DAYS,
  MAX_RECENT_ROWS,
  MAX_WINDOW_TOP,
  RANK_ORDERS,
  RECENT_TX_KINDS,
  RICH_LIST_MAX_N,
  RICH_LIST_TOP_N,
  SITE_GUIDE_SECTIONS,
  TRANSPARENT_MEASURES,
  WINDOW_GROUP_BY,
  WINDOW_MEASURES,
} from "./specs";

/** OpenAI-format tool definitions, closed schemas throughout. */
export function toolDefinitions() {
  /*
   * The currency parameter, on every tool that can carry a money figure.
   *
   * A bare string with no enum: the offered set is ~29 values, and every enum value is a token in the
   * fixed prefix on every turn across several tools. The server validates anyway, and better: a
   * refusal can name the currency and offer the alternatives, where a schema violation cannot.
   *
   * Omitted from tools that can never carry one (`site_guide`, `calculate`, `zcash_reference`,
   * `wrapped_zec_pools`, whose figures are DeFiLlama's dollars and not ours to convert), because a
   * parameter that does nothing invites a call that does nothing.
   */
  const currencyParam = {
    currency: {
      type: "string",
      description:
        "Optional. A 3-letter currency code to value money figures in — e.g. eur, gbp, jpy, " +
        "btc — when the reader asks for one. Omit for US dollars, which is the default. If " +
        "this explorer holds no rate for the code, the tool says so rather than answering in " +
        "dollars; pass on that refusal instead of converting anything yourself.",
    },
  };
  const takesCurrency = new Set<ToolName>([
    "lookup_transaction",
    "lookup_block",
    "lookup_address",
    "chain_status",
    "explorer_analytics",
    "explorer_insights",
    "zec_price_history",
    "crosschain",
    "chain_activity",
  ]);
  const def = (
    name: ToolName,
    description: string,
    properties: Record<string, unknown>,
    required: string[],
  ) => ({
    type: "function" as const,
    function: {
      name,
      description,
      parameters: {
        type: "object" as const,
        properties: takesCurrency.has(name) ? { ...properties, ...currencyParam } : properties,
        required,
        additionalProperties: false as const,
      },
    },
  });
  return [
    def(
      "lookup_transaction",
      "Fetch a Zcash transaction by txid (64 hex chars), including its privacy view: which pools it touched, how value moved between transparent and shielded, and the fee it paid. It carries the number of transparent INPUTS and OUTPUTS it has, the addresses and amounts on each side, its total PUBLIC transparent value, and each shielded pool's own published value BALANCE for it. Use it for any question about a specific transaction — how many inputs or outputs it has, how much it moved publicly, what it cost, which pools it used, whether it shielded or unshielded value. A shielded amount is encrypted and arrives labelled as such rather than as a number.",
      { txid: { type: "string", description: "Transaction id, 64 lowercase hex characters." } },
      ["txid"],
    ),
    def(
      "lookup_block",
      "Fetch a Zcash block by height (e.g. 3428150) or block hash (64 hex chars): its timestamp, size, transaction count, difficulty, the total FEES the block collected, the miner reward and the payout address the coinbase named, plus the privacy mix of what it contains. Use it for anything about one block — how big it was, how much it paid in fees, who mined it, what it held. Set withTransactions to also list the first few transactions in it — the block's own txCount is always the true total, whatever the list shows. For fees or block counts ACROSS a period, and for which block or day was the biggest or busiest, use chain_activity.",
      {
        heightOrHash: { type: "string", description: "Block height as digits, or block hash." },
        withTransactions: {
          type: "boolean",
          description:
            "Also fetch the block's first few transactions. Use it when the question is about what is IN the block rather than about the block itself.",
        },
      },
      ["heightOrHash"],
    ),
    def(
      "lookup_address",
      "Fetch a Zcash address summary. Transparent addresses return balance, total received and sent, the transaction count for how many transactions the address appears in, and its rank on the transparent rich list — so 'how big is this address', 'where does it rank' and 'how many transactions has it made' are all answerable here. Shielded addresses return an explanation and no balance, because one holder's shielded balance is not knowable by design. An address beginning tm, t2, utest1 or ztestsapling1 is a TESTNET address: this deployment indexes mainnet, so say it is a testnet address that the testnet explorer at testnet.shieldedscan.xyz covers — never call the prefix invalid. Set withTransactions to also list its most recent transactions — transparent addresses only, and a shielded one has no such history to list, by design rather than by omission. Set withValueExtremes for the address's BIGGEST and SMALLEST transactions: the largest amount it ever received and the largest it ever sent in a single transaction — its own net change in that transaction, alongside the whole transaction's public transparent value as a separate figure, each with how many transactions share the record. Use that for 'the largest transaction for this address', 'the most it ever received or sent at once', or a whale's record movement. Pass `from` and `to` for what the address did in a PERIOD rather than over all of history: how many transactions it made, how much ZEC it received and how much it sent between those dates, with its lifetime count beside them. That answers 'how many transactions did this address make in July', 'how much did it receive last month', 'was it active in 2024' and any how-many/how-much question about one address over any span of days. A POOL's total balance is a different quantity and is public — that comes from chain_status.",
      {
        address: { type: "string", description: "A Zcash address (t1…, t3…, zs…, u1…)." },
        withTransactions: {
          type: "boolean",
          description:
            "Also fetch the address's most recent transactions, newest first. Transparent addresses only.",
        },
        withValueExtremes: {
          type: "boolean",
          description:
            "Also fetch the largest amounts this address ever received and sent in one transaction. Transparent addresses only.",
        },
        from: {
          type: "string",
          description:
            "Start of a period, a UTC day as YYYY-MM-DD. Inclusive. Pass with `to` to get what this address did in that period rather than over all of history.",
        },
        to: {
          type: "string",
          description:
            "End of the period, a UTC day as YYYY-MM-DD. EXCLUSIVE — for the whole of July use from=2026-07-01 and to=2026-08-01.",
        },
        lastDays: {
          type: "integer",
          description:
            "A TRAILING window of this many days, ending today — for 'what has this address done in the last 90 days', 'the past three weeks', and any period counted back from now, so you never work a date out yourself. Not to be combined with from/to.",
        },
      },
      ["address"],
    ),
    def(
      "chain_status",
      // A tool description is the only thing routing a question to its data, so it must carry the
      // words a visitor would use for every quantity the payload holds ("miner", "funding streams",
      // "lockbox", "halving", "reorg"). The routing-coverage test enforces this.
      "Current chain facts, and the live protocol figures. Facets: 'chain' (tip height, best hash, circulating supply, ZEC/USD price if measured, and ZEC's MARKET CAP — the market capitalisation is computed for you here, so use this for what Zcash is worth in total); 'supply' (the six value pools, which partition all ZEC — plus how much ZEC has been MINED so far and how much is still UNMINED against the 21 million cap, and the shielded share of circulating supply; use it for how much ZEC exists, how much is left to mine, and how much of it is shielded); 'tx-counts' (ALL-TIME transaction counts by privacy kind — how many transactions Zcash has EVER had that were transparent, fully shielded, coinbase, or mixed, plus the two directions inside mixed: how many SHIELDING transactions (value entering the shielded pools) and how many UNSHIELDING ones (value leaving them) there have ever been. Use it for any \"how many X transactions have there ever been / in total / all time\" question. The two directions plus \"indeterminate\" (mixed transactions whose pools moved opposite ways, so no single direction can be named) PARTITION mixed exactly — they are parts of mixed, never a fifth privacy kind and never siblings of the total, and the all-time total already contains them — never add them to it); 'status' (service health, price if measured); 'halving' (every PAST halving with its HEIGHT and DATE — and Blossom's block-time change, labelled as not a halving — so 'when was the last halving', 'when did each halving happen' and 'what was the subsidy before and after each one' are answerable here, and a price-on-halving-day question gets its days from here first; plus how the block subsidy is SPLIT right now and what it becomes after the next halving — the miner's share, the funding streams' share and the lockbox's share, each as a percentage already computed, with every individual funding stream named and the ZIP that defines it; plus blocks remaining to the halving. Use it for what proportion of the block reward or of a miner's reward goes to funding streams, to the dev fund or to the lockbox, for how the reward is divided up and who gets what, and for when the halving is); 'fees' (the ZIP-317 conventional fee schedule, its marginal fee per logical action, and worked examples — what a wallet pays by default); 'reorgs' (this node's own observed chain rollbacks, with how many and when the last one was); 'market' (how Zcash's market capitalisation compares with LARGER assets, using CoinGecko's figures — each asset's market cap, its price, its rank, the multiple of Zcash's own market cap it represents, and the IMPLIED PRICE of one ZEC at that asset's market cap, all computed for you. Use it for 'what would ZEC be worth at Bitcoin's market cap', 'how much bigger is Ethereum than Zcash', 'how does Zcash compare with X', and any what-if about Zcash reaching another asset's valuation); 'records' (ALL-TIME RECORDS: the highest, lowest and lowest non-zero FEE ever paid by one transaction and by one block, the largest and smallest transparent amount ever moved by one transaction, and the largest single shielding and unshielding ever, each naming its transaction or block when it is unique, for 'what is the biggest fee ever paid' or 'the largest shielding ever'); 'mining' (the MINING TERMS at the tip: difficulty, the network's SOLUTION RATE in Equihash solutions per second, the miner's subsidy per block, the observed block interval and the height the subsidy next changes); 'nodes' (the NETWORK'S NODES from this explorer's crawler: how many nodes answered in the last day, how many addresses were ever advertised, IPv6 and Tor counts, which COUNTRIES they are in, which CLIENT software and VERSION they run (Zebra, Zakura, zcashd), their protocol versions, and which hosting providers or network operators hold most of them, for 'how many Zcash nodes are there', 'which country has the most nodes' or 'what share run Zebra'). Use 'supply' for any question about how much ZEC a pool holds, in ZEC or in dollars: EVERY pool's total balance is public, the shielded pools included, and each one arrives with a dollar figure already computed beside it. For how the split was set in an EARLIER era, or which organisation a ZIP directs a stream to, use zcash_reference 'economics'.",
      {
        include: {
          type: "array",
          items: { type: "string", enum: Object.keys(CHAIN_STATUS_FACETS) },
          description: "Which facets to fetch, one call each.",
        },
      },
      ["include"],
    ),
    def(
      "explorer_analytics",
      // Names dollars because the swap-time USD figures are in the payload; a description that does not
      // say so cannot route the question that needs them.
      "Aggregate series this explorer publishes. 'monthly' is per-month transaction counts and shielded share; 'crosschain-flows' is ZEC crossing to/from other chains via public swap venues, per counterpart chain and direction, WITH the venues' own swap-time USD value of those crossings — so use it for what a chain's crossings were worth in dollars as well as in ZEC (a floor, never a total); 'mempool' is the current mempool summary — how many transactions are pending, their total size, and the median fee and fee rate among them where those were measured.",
      { series: { type: "string", enum: Object.keys(ANALYTICS_SERIES) } },
      ["series"],
    ),
    def(
      "explorer_insights",
      // 'ironwood-inflow' names Orchard, the turnstile and "migrated" explicitly so a question like "what
      // ratio of ZEC moved from Orchard to Ironwood?" routes here.
      "Deeper analytics this explorer derived from its own full-chain index and publishes on its pages — series the public API does not serve. Topics: 'ironwood-inflow' (how many TRANSACTIONS have used the Ironwood pool since it activated, and where the pool's balance CAME FROM: how much migrated from Orchard through the NU6.3 turnstile, how much from Sapling or Sprout, how much is fresh shielding from transparent, and how much was mined straight in — each with its share of the balance already computed, so use this for any question about Orchard→Ironwood migration, the turnstile, or what proportion of the pool came from where; ALSO the COUNT of pool-to-pool migration transactions between EVERY pair of pools — from and to each pool, all scenarios — with the ZEC amount each pair moved AND its dollar value in USD at the time (each transaction at its own day's close, today's at the current price, computed here), per window: the last 24 hours, the last 7 days, the last 30 days, plus into-Ironwood since activation. **For migrations over ANY OTHER period — a named year, a date range, or all of history — and for a PER-DAY or PER-MONTH breakdown of any pair, use `chain_activity` 'window' instead, which returns the same directed matrix for whatever period you ask for, can split it by day or month, and can price it in a currency other than the dollar.** These fixed windows are a convenience, not the limit — so 'how many transactions migrated from Orchard to Ironwood in the last 24 hours', 'migrations between all pools this week' and 'what was that worth in dollars' are answerable with pre-computed figures); 'shielding-flow' (gross ZEC shielded and unshielded per day, both directions); 'transaction-costs' (median, mean and quartile fees per privacy kind — transparent, fully shielded, and mixed — with sample sizes, plus the monthly trend of each, so it answers 'does privacy cost more' and what a transaction of any one kind costs; ALSO the all-time fee RANGE — the lowest and the highest fee ever paid by a single transaction, and ever collected by a whole block, each with how many share that exact figure — so use it for the cheapest, the most expensive, the minimum, the maximum or the record fee, whether asked about a transaction or a block, INCLUDING the lowest NON-ZERO fee — the smallest fee anyone actually paid, a separate figure from the zero-fee minimum; each named record also arrives with what it was worth in USD dollars at its own day's close, already computed, so use this for what a record fee or record transaction was worth at the time; and the all-time VALUE range, the largest and smallest transparent amount any single transaction has ever moved, for the biggest or smallest transaction by value rather than by fee); 'holder-distribution' (the RICHEST TRANSPARENT ADDRESSES, ranked — it names the single largest holder and the top 10 by address, with each one's rank, balance in ZEC and in USD dollars, and transaction count, so use it for 'which address holds the most ZEC' and 'what are those holdings worth in dollars' and any question naming a richest, largest or top holder — plus how transparent ZEC is spread across the addresses holding it: the number of holders, the total they hold, what the top 10, 100 and 1,000 hold, the spread across balance bands each valued in USD dollars, and the UNATTRIBUTED amount sitting in outputs that name no single address and is excluded from all of it; the figures arrive beside ZEC's CIRCULATING SUPPLY and its MARKET CAP, so what the top holders hold can be set against all the ZEC there is; transparent addresses only, never a ranking of Zcash wealth, because shielded balances belong to no enumerable address, and the addresses are named while their OWNERS never are); 'crosschain-volume' (ZEC crossing to and from Zcash per month and per day, with the venues' own swap-time USD value beside it and trailing 7- and 30-day totals of both, public swap venues only, so a floor).",
      {
        topic: {
          type: "string",
          enum: Object.keys(INSIGHT_TOPICS),
          description: "Exactly one topic per call.",
        },
        fromRank: {
          type: "integer",
          description: `'holder-distribution' only: start the ranked list at this absolute rank instead of at 1, so "who is the 500th largest holder" and "show me holders 50 to 100" are answerable. 1-based. Up to ${RICH_LIST_MAX_N} rows come back from wherever it starts.`,
        },
        count: {
          type: "integer",
          description: `'holder-distribution' only: how many ranked holders to return, 1 to ${RICH_LIST_MAX_N}. Defaults to ${RICH_LIST_TOP_N}.`,
        },
      },
      ["topic"],
    ),
    def(
      "zec_price_history",
      // `on` is named because "the price when X happened" (pool launches, upgrades, halvings) is a class
      // of question a window cannot express. The reach is stated so the 1,000-row page edge is never
      // mistaken for the start of the series.
      "Daily ZEC/USD CLOSING prices this explorer stores, one row per completed UTC day, each naming the aggregator that published it — there is no canonical daily ZEC price, so the source belongs in the answer. The series reaches back to Zcash's launch year, 2016; a response states its true extent in availableFrom/availableTo, which is NOT the same as the page you were handed. Two ways to ask: 'on' names exact days (use it for the price on the day something happened — a pool launch, an upgrade, a halving — including several unrelated days at once), or 'days' counts back from yesterday, or back from 'to' when a last day is given. The change across a window is computed here and supplied ready to quote, and every response carries the ALL-TIME HIGH and ALL-TIME LOW close over the whole series (day, price and source) — so 'what was ZEC's highest ever price', 'the record close' and 'the lowest it has been' need one call and no paging. This is HISTORY, not the current price — that is chain_status — and it supports no forecast or price prediction of any kind.",
      {
        on: {
          type: "array",
          items: { type: "string" },
          description: `Exact UTC days as YYYY-MM-DD, up to ${MAX_PRICE_DAY_PICKS}, each answered separately. Use instead of days/to, never with them.`,
        },
        days: {
          type: "integer",
          description: `How many days of closes, 1 to ${MAX_PRICE_DAYS}. A week is 7.`,
        },
        to: {
          type: "string",
          description:
            "Optional last day of the window, as YYYY-MM-DD. Omit for the most recent closes; supply it only when the question names a past period.",
        },
      },
      // Nothing is required: `on` is an alternative to `days`, not an extra filter. Exactly one must be
      // present, which these schemas cannot express, so `callsFor` enforces it and returns a correctable
      // message naming both modes.
      [],
    ),
    def(
      "zip_index",
      "The index of every numbered Zcash Improvement Proposal (ZIP), read live from github.com/zcash/zips: each ZIP's number, title, category, status (Final, Active, Proposed, Draft, Reserved, Withdrawn, Rejected, Obsolete — the header's own Status line, kept whole) and the day it was created, plus a link to its canonical page and when the index was last read. Use it for any question about which ZIPs exist, what a ZIP is called, what status a ZIP has, how many ZIPs there are or are drafts, which ZIPs are proposed or in force, the newest or most recently created ZIPs, or to find a ZIP by a word in its title. It carries LABELS only, never a ZIP's text: for what a ZIP specifies, give the link it returns.",
      {
        zip: {
          type: "array",
          items: { type: "integer" },
          description: `ZIP numbers to look up, up to ${MAX_ZIP_PICKS} in ONE call (e.g. [218, 235, 237]) — ask for every ZIP a question names at once rather than one call each. Omit to list.`,
        },
        section: {
          type: "string",
          enum: [...ZIP_SECTION_IDS],
          description:
            "Narrow to one section of the /zips page: 'in-force' (Final or Active), 'proposed', 'draft' (Draft, Reserved and unrecognised statuses), 'retired' (Withdrawn, Rejected, Obsolete).",
        },
        query: {
          type: "string",
          description: "A word or phrase to match, case-insensitively, inside ZIP titles.",
        },
      },
      [],
    ),
    def(
      "crosschain",
      "ZEC crossing between Zcash and other chains through public swap venues (a floor on real movement, never a total). Use this for ANY cross-chain question that names a chain, a venue, a period, or a particular crossing — it is the only tool that combines those. Modes: 'aggregate' totals and breaks down a slice (filter by chain, venue, direction, a date window — absolute, or a trailing one of ANY length such as the last 46 days — and a MINIMUM DOLLAR VALUE at swap time; group by 'chain', 'venue', 'month', 'day' or 'none') and answers 'how much ZEC came from Bitcoin in July', 'which venue moves the most', 'how has ETH volume changed month by month', and — with `minUsdAtSwap` or `minZec` — 'HOW MANY crossings were worth more than $10k' or 'how many moved more than 5,000 ZEC', which comes back as a count and needs no counting by hand, in ZEC and in the venues' own swap-time dollars; 'transfers' lists individual crossings, either the most recent or — with sort 'largest' — the biggest by ZEC or by swap-time USD, so it answers 'what was the largest crossing', and takes the same dollar or ZEC threshold; 'destinations' reports the address FAMILY inbound ZEC lands on, i.e. what share arrived at an address capable of receiving shielded funds. For the all-time per-chain picture use explorer_analytics 'crosschain-flows'; for wrapped ZEC sitting in pools on other chains, which is a different quantity entirely, use wrapped_zec_pools.",
      {
        mode: {
          type: "string",
          enum: [...CROSSCHAIN_MODES],
          description: "Exactly one mode per call.",
        },
        chain: {
          type: "string",
          description:
            "One counterpart chain ticker, e.g. BTC, ETH, SOL — matched at whichever end is not Zcash. Omit for every chain.",
        },
        venue: {
          type: "string",
          enum: [...CROSSCHAIN_VENUES],
          description: "One swap venue. Omit for every venue.",
        },
        direction: {
          type: "string",
          enum: [...CROSSCHAIN_DIRECTIONS],
          description:
            "'in' is ZEC arriving on Zcash, 'out' is ZEC leaving. Omit to get both, which 'aggregate' reports separately.",
        },
        from: {
          type: "string",
          description: "Start of the window, a UTC day as YYYY-MM-DD. Inclusive.",
        },
        to: {
          type: "string",
          description:
            "End of the window, a UTC day as YYYY-MM-DD. EXCLUSIVE — for the whole of July use from=2026-07-01 and to=2026-08-01.",
        },
        lastDays: {
          type: "integer",
          description:
            "A TRAILING window of this many days, ending today — use it for 'the last 46 days', 'the past fortnight', 'the last 6 months' and any other period counted back from now, so you never work a date out yourself. Not to be combined with from/to, which name an absolute period instead.",
        },
        groupBy: {
          type: "string",
          enum: [...CROSSCHAIN_GROUP_BY],
          description: "'aggregate' only. Defaults to 'none', which returns totals alone.",
        },
        sort: {
          type: "string",
          enum: [...CROSSCHAIN_SORTS],
          description:
            "'transfers' only. Defaults to 'newest'. 'largest' and 'smallest' rank by amount and answer the biggest/smallest-crossing questions.",
        },
        by: {
          type: "string",
          enum: [...CROSSCHAIN_RANK_UNITS],
          description:
            "'transfers' with sort 'largest' or 'smallest' only. 'usd' ranks by the venues' swap-time price and therefore leaves out every transfer no venue priced — at BOTH ends, because an unpriced transfer is a value nobody published, never a small one. Defaults to 'zec'.",
        },
        limit: {
          type: "integer",
          description: `'transfers' only: how many rows, 1 to ${MAX_CROSSCHAIN_ROWS}. Defaults to 5.`,
        },
        minUsdAtSwap: {
          type: "number",
          description:
            "'aggregate' and 'transfers': count or list only the crossings worth at least this many US DOLLARS at the venue's own swap-time price — the filter for 'more than $10k', 'above $100,000', 'over a million'. A crossing no venue priced is excluded rather than assumed to clear it, so the result is a floor. Omit for every crossing whatever it was worth. For a threshold stated in ZEC use minZec instead — never convert one into the other.",
        },
        minZec: {
          type: "number",
          description:
            "'aggregate' and 'transfers': count or list only the crossings that moved at least this many ZEC (a decimal ZEC amount, not zatoshi) — the filter for 'more than 5k ZEC', 'above 1,000 ZEC', 'over 10000 ZEC'. Every row carries its exact ZEC amount, so nothing is excluded for want of a price. Omit for every crossing whatever its size.",
        },
      },
      ["mode"],
    ),
    def(
      "chain_activity",
      // The description carries the words a visitor would use ("how many", "busiest", "average block
      // size", "what just happened"), or those questions route nowhere.
      "Zcash's own on-chain activity over a PERIOD, and what has just happened. 'window' totals a date range from this explorer's full-chain index — transaction counts by privacy kind, gross ZEC shielded and unshielded, fees with their block coverage, block count, block-weighted average difficulty and block size, and the four shielded pools' CLOSING balances at the window's last block (Sprout, Sapling, Orchard, Ironwood) — optionally broken down by 'day' or 'month'. It also counts HOW MANY TRANSACTIONS USED EACH SHIELDED POOL in that period — per-pool transaction counts for Sprout, Sapling, Orchard and Ironwood, plus how many used no pool at all — so 'how many Orchard transactions were there on 23 January 2023', 'how many transactions used Sapling last month' and 'which pool was used most in July' are answerable for ANY window, including all of history — ask for the period the reader asked for and never split it into shorter ones. It also returns the DIRECTED POOL-TO-POOL MIGRATION MATRIX for the window — every (source, destination) pair that occurred, with how many transactions and how much ZEC moved from each pool into each other pool, and what that was worth, each day PRICED at its own day's close so 'how much moved from Orchard into Ironwood in 2025, in dollars or euros' is one call. The matrix SPLITS PER DAY or PER MONTH too: pass migrationFrom/migrationTo with groupBy and each period carries its own migration count and amount for that pair — 'how many Orchard to Ironwood migrations for every day in the last week', 'daily migrations into Ironwood this month' and any per-day or per-month pool-to-pool question is ONE call, never a refusal and never a window total divided by days. Use it for 'how many shielded transactions in July', 'which day shielded the most', 'how has activity changed month by month', 'average block size last month', 'what did the Orchard pool hold at the end of July', and any how-many/how-much question about the chain over any period, including the last N days; the totals are computed here, so never sum a series yourself. It covers ALL of recorded history, not just the last year. Windows are WHOLE UTC DAYS — there is no hourly figure anywhere here: for 'the last hour' or 'right now' give today's count so far (a window ending tomorrow) and the newest rows from 'recent-transactions', and say the finest grain is a day. Per-pool counts cover ANY window, including all of history, so ask for the period the reader asked for in ONE call — never split a year into halves or quarters. 'recent-blocks' and 'recent-transactions' are the newest few of each, for what is happening right now — each recent block carries its miner, its total block reward and the miner's own share of it after funding streams, so 'what did the last block pay?' is answerable — and 'recent-transactions' can be narrowed to one privacy kind, including 'shielding' (value entering the shielded pools) and 'unshielding' (value leaving them for a transparent address), so 'show me recent shielding transactions' is answerable. It also counts SHIELDING and UNSHIELDING transactions for the period — how many transactions moved value INTO the shielded pools and how many moved it OUT, per day or month, which together with the indeterminate remainder split the mixed count exactly. With `sort` it RANKS those periods instead of listing them by date — the busiest, quietest, biggest or highest day or month for transactions, shielding transactions, unshielding transactions, fully shielded transactions, ZEC shielded, ZEC unshielded, fees paid, blocks mined, average block size or difficulty. That answers 'which day had the most transactions', 'which day in 2024 had the most shielding transactions', 'which day shielded the most ZEC', 'which month paid the most fees', 'the quietest week', and any other most/least/highest/lowest/record question about a period. Keep the four apart: shielding transactions are a COUNT and ZEC shielded is an AMOUNT, and fully shielded transactions are a different class with no transparent side at all. The ranking runs over EVERY period in the window before any display trimming, so it is exact for a whole year, not just recent weeks. Shielding and unshielding counts can be narrowed to a VALUE THRESHOLD with minValue or minZec — how many crossings were WORTH MORE THAN a given amount, over $100k, above 1,000 ZEC, large shielding transactions, big deposits into the shielded pools — per day or month, each transaction valued at its OWN day's closing price. That is the only value floor here: it narrows shielding and unshielding only, never transparent or fully shielded transactions, whose per-transaction amounts this index does not aggregate. 'miners' says WHO MINED a period, by payout address: how many blocks each address mined and its share of all blocks, its reward and the fees in it, the coinbase tag of its newest block, the concentration of the largest one, three and ten addresses, and how many blocks paid their miner into a shielded pool or to a bare public key — for 'which mining pool mined the most blocks last month', 'how concentrated is Zcash mining', 'what share did the top miner have in 2024' and any miner or mining-pool question over any period, all of history included. 'transparent' says how much ZEC moved through TRANSPARENT addresses and HOW MANY ADDRESSES WERE ACTIVE: the ZEC paid to transparent outputs (change included) and spent from transparent inputs, by kind, per day or month, and the EXACT number of distinct transparent addresses that sent, received, or either — ACTIVE ADDRESSES, unique addresses — for a day, a calendar month, and the trailing 7, 30 and 90 days, all of history included. Use it for 'how many active addresses last month', 'unique addresses in the last 30 days', 'how much ZEC moved transparently yesterday', 'transparent volume in 2025' and, with sort 'active-addresses', 'which day had the most active addresses'. 'pools' says HOW EACH SHIELDED POOL WAS USED: transactions that used Sprout, Sapling, Orchard or Ironwood, split into fully shielded, mixed (shielding, unshielding) and coinbase; each pool's bundle counts (Sapling spends and outputs, Orchard and Ironwood actions, Sprout JoinSplits); and its NOTE COMMITMENT TREE, the ANONYMITY SET a spend hides in. Use it for 'how big is the Orchard anonymity set', 'how many notes are in Sapling' and 'how many fully shielded Ironwood transactions'. Without groupBy all four pools come back in one call; per day or month it takes one pool. 'pool-balances' gives each shielded pool's CLOSING BALANCE per day or month, for 'how has the Orchard pool's balance changed this year' or 'what did Sapling hold at the end of each month of 2024'. For cross-chain movement use crosschain; for fee medians and quartiles use explorer_insights 'transaction-costs'.",
      {
        mode: {
          type: "string",
          enum: [...CHAIN_ACTIVITY_MODES],
          description: "Exactly one mode per call.",
        },
        from: {
          type: "string",
          description:
            "'window', 'miners', 'transparent', 'pools' and 'pool-balances'. Start of the period, a UTC day as YYYY-MM-DD. Inclusive.",
        },
        to: {
          type: "string",
          description:
            "'window', 'miners', 'transparent', 'pools' and 'pool-balances'. End of the period, a UTC day as YYYY-MM-DD. EXCLUSIVE — for the whole of July use from=2026-07-01 and to=2026-08-01. Omit both for all of history.",
        },
        lastDays: {
          type: "integer",
          description:
            "'window', 'miners', 'transparent', 'pools' and 'pool-balances'. A TRAILING window of this many days, ending today — for 'the last 46 days', 'the past three weeks', 'the last 6 months' and any other period counted back from now, so you never work a date out yourself. Not to be combined with from/to.",
        },
        groupBy: {
          type: "string",
          enum: [...WINDOW_GROUP_BY],
          description:
            "'window', 'transparent', 'pools' and 'pool-balances'. Defaults to 'none', which returns the totals alone ('transparent' then lists months; 'pool-balances' always lists months unless 'day'). 'day' needs a window of at most 366 days for every mode except 'window'.",
        },
        sort: {
          type: "string",
          enum: [...WINDOW_MEASURES, ...Object.keys(TRANSPARENT_MEASURES)],
          description:
            "'window' and 'transparent', and requires groupBy day or month: rank the periods by this measure instead of returning them in date order. This is how every superlative question is answered — busiest, biggest, highest, quietest. 'active-addresses', 'transparent-output-value' and 'transparent-input-value' rank 'transparent' periods; the rest rank 'window'.",
        },
        order: {
          type: "string",
          enum: [...RANK_ORDERS],
          description:
            "'sort' only. Defaults to 'highest'. Use 'lowest' for quietest, smallest or cheapest.",
        },
        top: {
          type: "integer",
          description: `'sort' only: how many periods to return, 1 to ${MAX_WINDOW_TOP}. Defaults to ${DEFAULT_WINDOW_TOP}. Use 1 only when the question wants a single period, and check ranking.tiedAtTop before naming it.`,
        },
        minValue: {
          type: "number",
          description:
            "'window' only. A VALUE FLOOR, in the requested currency (dollars unless `currency` says otherwise): count only shielding and unshielding transactions worth at least this much, each valued at ITS OWN day's closing price. For 'how many shielding transactions over $100k each day', pass minValue=100000 with groupBy='day'. It narrows the shielding and unshielding counts ONLY — every other figure in the payload stays the whole window's.",
        },
        minZec: {
          type: "number",
          description:
            "'window' only. The same floor as an exact ZEC amount rather than a currency figure — for 'crossings above 1,000 ZEC'. No price is involved, so it covers every day including today. May be combined with minValue, and then both must be cleared.",
        },
        migrationFrom: {
          type: "string",
          enum: [...POOL_MIGRATION_SOURCES],
          description:
            "'window' only. Narrow the pool-to-pool migration matrix to migrations FROM this pool — the losing side. 'multi' means two or more pools lost in one transaction. With groupBy 'day' or 'month', each period then carries its own migration cells, which is how 'how many Orchard to Ironwood migrations each day last week' is answered — pass migrationFrom='orchard', migrationTo='ironwood', groupBy='day' in ONE call.",
        },
        migrationTo: {
          type: "string",
          enum: [...POOL_MIGRATION_DESTINATIONS],
          description:
            "'window' only. Narrow the migration matrix to migrations INTO this pool — the gaining side. One side alone is enough: migrationTo='ironwood' with groupBy='day' gives every pool's daily migrations into Ironwood.",
        },
        pool: {
          type: "string",
          enum: [...POOL_NAMES],
          description:
            "'pools' only. One shielded pool. Required with groupBy day or month; without a grouping, omit it to get all four.",
        },
        kind: {
          type: "string",
          enum: [...RECENT_TX_KINDS],
          description:
            "'recent-transactions' only. 'shielded' is fully shielded, 'mixed' has both a transparent and a shielded side. Defaults to every kind.",
        },
        limit: {
          type: "integer",
          description: `'recent-*': how many rows, 1 to ${MAX_RECENT_ROWS}, default ${DEFAULT_RECENT_ROWS}. 'miners': how many payout addresses to list, 1 to ${MAX_MINER_ROWS}, default ${DEFAULT_MINER_ROWS}; the rest are folded together.`,
        },
      },
      ["mode"],
    ),
    def(
      "wrapped_zec_pools",
      "Liquidity pools on OTHER chains holding wrapped or bridged ZEC — TVL in USD dollars and yield (APY) per pool, as published by DEFILLAMA, a third party whose figures cannot be checked against the Zcash node. This is a STOCK of wrapped ZEC sitting in pools, not ZEC moving between chains: for movement use explorer_analytics 'crosschain-flows' or explorer_insights 'crosschain-volume'. Wrapped ZEC is not ZEC on the Zcash chain and says nothing about Zcash's supply or its shielded pools. No parameters.",
      {},
      [],
    ),
    def(
      "zcash_reference",
      // The words a visitor would use, not the bucket names: "how many people were in the ceremony" has
      // to reach `ceremonies` without the asker knowing that word.
      "Documented facts about Zcash's protocol, history, cryptography and governance that this explorer does NOT measure — committed in its source with a primary source beside each one. Topics: 'ceremonies' (the Sprout and Sapling trusted-setup ceremonies, how many participants each had, toxic waste, and why Orchard needed none); 'cryptography' (which proving system each pool uses — BCTV14, Groth16, Halo 2); 'history' (dated events: mainnet launch, the 2018 counterfeiting vulnerability and its fix, the full network-upgrade order, and the activation height AND UTC date of Overwinter, Blossom and Heartwood); 'economics' (how the block subsidy has been split in each era — ZIP 214's dev-fund and funding-stream percentages per block range, the miner's share alongside them, the lockbox, and the Founders' Reward that preceded all of it); 'governance' (the ZIP process, and which organisations consensus funds); 'addresses' (what the address types are and what they reveal — transparent versus shielded, and unified addresses: what a u1 address is, which receivers and pools it can bundle, the ZIP 316 typecodes and the u/zu/tu prefixes, and why one cannot be read by eye); 'privacy' (the encrypted MEMO field — its 512-byte size and how a wallet marks text versus binary — and what a VIEWING KEY exposes, which is every transaction of an address); 'consensus' (the proof-of-work algorithm Equihash and who devised it; why blocks target 75 seconds and what the 150-second pre-Blossom target and the halving interval were; and how a network upgrade activates at all — CONSENSUS_BRANCH_ID, activation by block height, no miner vote); 'roadmap' (what Zcash is PROPOSING and has NOT shipped — the NU7 upgrade and why it has no activation height or date, which ZIPs are only CANDIDATES for it, the coinholder vote on NU7's scope with its snapshot block, its Ironwood-only eligibility rule and its participation minimum, Project Tachyon and what it proposes, and the Network Sustainability Mechanism proposals ZIP 233, ZIP 234, ZIP 235 and ZIP 1016 with the status each carried on the day it was read). Use it for any 'what is', 'how does', 'how many', 'when did', 'who', 'why', 'what is next', 'what is being voted on' or 'what is coming' about Zcash itself. Everything in 'roadmap' is a status READ ON A STATED DAY and may have moved since; every other topic is settled and does not go stale. NOT for a LIVE CHAIN FIGURE — tip, supply, price, halving countdown, the current subsidy split and fee schedule are chain_status.",
      {
        topic: {
          type: "string",
          enum: REFERENCE_TOPIC_NAMES,
          description: "Exactly one topic per call. Call again for another.",
        },
      },
      ["topic"],
    ),
    def(
      "site_guide",
      // The words a visitor uses, not the section names: "how many requests per second" contains none of
      // "descriptor", "contract" or "rate limit", so the description names the quantity itself.
      "What this explorer itself publishes: its pages, and its public API's contract — and what its privacy policy states, and its /donate page, which carries this site's own donation address — for 'what is your donation address' point at /donate and never paste or recall an address. Sections: 'api' (the live API descriptor — RATE LIMITS in requests per second and per minute, the global ceiling, whether a key is needed, the conventions every response follows, every endpoint path that exists, and what the API deliberately refuses to serve); 'api-endpoint' (one endpoint in full: its parameters, a pinned example response and a runnable curl — pass the path or a word like 'blocks'; anything unmatched returns the complete list); 'pages' (the pages this site publishes and what is on each, for 'where do I see X'); 'privacy' (THE PRIVACY POLICY, in its own words — cookies, trackers, browser storage, accounts, API keys, what this project's own servers log, the named third parties that carry a request and what each of them records, every place data leaves the browser including this agent, the legal basis and your rights. Use it for ANY question about privacy, tracking, cookies, logging, IP addresses, retention, who sees a request, what is stored, GDPR or data protection, and NEVER answer one from memory); 'labels' (EVERY ADDRESS THIS SITE NAMES — exchange and custodian wallets, and addresses flagged in public investigations of a theft, hack or exploit — with whose attribution each is; use it for any question naming an exchange or an incident, such as 'was there an exploit', 'which addresses belong to Binance', 'is this a hacker's address', and ALWAYS before saying this explorer has nothing on an exchange or an incident); 'coverage' (this explorer's own register of quantities it does NOT publish — value thresholds on transparent or fully shielded transactions, distinct addresses over a span that is not a day, a calendar month or the last 7, 30 or 90 days, per-holder shielded balances — each with the reason and the nearest figure that IS published). Use it for any question about how to USE this explorer or call its API, including limits, quotas, keys and throttling — and ALWAYS BEFORE TELLING ANYONE A FIGURE ABOUT ZCASH IS UNAVAILABLE: 'coverage' says whether the gap is real, what kind of gap it is, and what to answer with instead.",
      {
        section: {
          type: "string",
          enum: [...SITE_GUIDE_SECTIONS],
          description: "Exactly one section per call.",
        },
        endpoint: {
          type: "string",
          description:
            "'api-endpoint' only: the endpoint to describe, as a path (/v1/blocks) or a word (blocks). Omit to list them all.",
        },
      },
      ["section"],
    ),
    def(
      "calculate",
      // The description repeats the preference order (payload figures first) because the definition is
      // the one text guaranteed to sit beside the temptation.
      "Exact arithmetic, evaluated by this explorer — use it for any derivation the data does not already carry: a sum, a difference, a ratio, a unit conversion, a what-if. Never do arithmetic in your head; put it through this instead. PREFER a figure already computed in a payload when one exists (…Zec siblings, …Share percentages, valueUsdText, trailingTotals, the window totals) — those are this site's published figures and recomputing one risks disagreeing with the page. State where each operand came from, and never mix bases in one expression (a historical amount times today's price describes nothing that happened). Numbers, + - * / and parentheses only.",
      {
        expressions: {
          type: "array",
          items: { type: "string" },
          description: `Up to ${MAX_EXPRESSIONS_PER_CALL} arithmetic expressions, each evaluated separately — e.g. "13135.34847561 * 34.12" or "(620 / 4620) * 100". Numbers (commas allowed as thousands separators), + - * / and parentheses. No symbols, names or units.`,
        },
      },
      ["expressions"],
    ),
  ];
}
