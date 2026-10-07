import {
  addressLabel,
  type ChainWindowBucket,
  type ChainWindowMeasure,
  DAY_MS,
  DAY_SECONDS,
  type FeeDistribution,
  freshShieldingPct,
  type IronwoodInflow,
  ironwoodSourceShares,
  rankBuckets,
  shieldedShareOfCirculatingPct,
  shieldedVsTransparentPct,
  utcDayFromMs,
} from "@/domain";
import {
  compareToZec,
  eligibleAssets,
  type MarketAsset,
  type MarketSnapshot,
} from "@/domain/market";
import { formatMultiple, formatUsdCompact, formatUsdExact, formatZecAmount } from "@/lib/format";
import { formatMoneyCompact, formatMoneyExact, formatZatMoneyApprox } from "@/lib/money";
import { USD } from "../../fx-rates";
import { asRecord } from "./json";
import {
  CROSSCHAIN_WINDOW_MEANING,
  NO_USD_VALUATION_MEANING,
  PRICE_CHANGE_MEANING,
  SHIELDING_WINDOW_MEANING,
  USD_VALUATION_MEANING,
  valuationMeaning,
} from "./notes";
import type { Valuation } from "./types";

/**
 * Figures this site derives for a payload before the model reads it (totals, shares, valuations,
 * rankings), so the model quotes them instead of doing arithmetic.
 */

/**
 * The name this site prints beside an address, resolved the way the page resolves it.
 *
 * From the address, never from the wire: a derived value sent over the wire is a second copy of the
 * fact, and `/rich-list` looks the name up from `ADDRESS_LABELS` at render time, so doing the same
 * here keeps the agent and the page in agreement.
 *
 * The agent may name it because it is this site's curated, per-entry-sourced table, already printed
 * on the pages; refusing to repeat it would be a false claim about this site. What stays refused is
 * naming the party behind an address with no entry.
 *
 * `source` travels so an answer can say whose attribution it is when asked; it is not meant to be
 * volunteered on every row.
 */
export function labelFor(address: unknown): { label?: string; labelSource?: string } {
  if (typeof address !== "string") return {};
  const found = addressLabel(address);
  return found === null ? {} : { label: found.name, labelSource: found.source };
}

/**
 * The ranked page, reshaped into what this topic wants from it.
 *
 * `topAddresses` rather than the endpoint's `items`, because the model reads the key name as the
 * claim. Cursors are dropped: they are pagination and would invite a sentence about more pages.
 * Fields are picked rather than passed through to save tokens; balance gains its `…Zec` sibling
 * downstream.
 */
export function enrichRichListTop(payload: unknown, v: Valuation): unknown {
  if (typeof payload !== "object" || payload === null) return payload;
  const items = (payload as { items?: unknown }).items;
  if (!Array.isArray(items)) return payload;
  return {
    topAddresses: items.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        rank: r.rank,
        address: r.address,
        ...labelFor(r.address),
        balanceZat: r.balanceZat,
        ...valueTextFor(r.balanceZat, v),
        // Null means not counted yet, never "none": an address holding a balance has been in at least one
        // transaction.
        txCount: r.txCount ?? null,
      };
    }),
  };
}

/** How many comparisons travel to the model. See `enrichMarket`. */
const MAX_MARKET_COMPARISONS = 25;

/**
 * The market snapshot, reshaped into the comparison `/compare` states, and nothing else.
 *
 * The raw payload is ~250 assets, most smaller than Zcash and so not answers to this facet's
 * question. Three rules:
 *
 *  - `eligibleAssets` and `compareToZec` are imported, never reimplemented: they decide what is
 *    comparable and anchor on the multiple, and a second copy would let the agent and the page
 *    disagree about a headline.
 *  - Every dollar and multiple arrives pre-formatted by the page's own formatters, so the string the
 *    agent quotes is character-for-character what `/compare` renders.
 *  - The list is capped and the true count (`comparableAssets`) travels with it: a silently
 *    truncated list looks complete.
 *
 * An empty list stays empty: "no asset is larger than Zcash" is a real answer, and the route 503s
 * when it has nothing to say. Hence this facet's `emptyIsAnAnswer`.
 */
export function enrichMarket(payload: unknown): unknown {
  if (typeof payload !== "object" || payload === null) return payload;
  const snapshot = payload as MarketSnapshot;
  const zec = snapshot.zec;
  if (typeof zec !== "object" || zec === null || !Number.isFinite(zec.marketCapUsd)) {
    return payload;
  }
  const asset = (a: MarketAsset) => ({
    id: a.id,
    symbol: a.symbol,
    name: a.name,
    marketCapUsd: a.marketCapUsd,
    marketCapUsdText: formatUsdCompact(a.marketCapUsd),
    priceUsd: a.priceUsd,
    priceUsdText: formatUsdExact(a.priceUsd),
    rank: a.rank,
  });
  const eligible = Array.isArray(snapshot.assets) ? eligibleAssets(snapshot) : [];
  const comparisons = eligible
    .slice(0, MAX_MARKET_COMPARISONS)
    .map((counterpart) => {
      const c = compareToZec(zec, counterpart);
      // Null only where the arithmetic has no answer; a row with no comparison invites the model to work
      // one out, so it is dropped.
      return c === null
        ? null
        : {
            ...asset(counterpart),
            multiple: c.multiple,
            multipleText: formatMultiple(c.multiple),
            impliedPriceUsd: c.impliedPriceUsd,
            impliedPriceUsdText: formatUsdExact(c.impliedPriceUsd),
          };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);
  return {
    source: "CoinGecko",
    asOf: snapshot.asOf,
    zec: asset(zec),
    comparableAssets: eligible.length,
    comparisons,
    ...(eligible.length > comparisons.length
      ? {
          comparisonsWithheld: `The ${eligible.length} assets larger than Zcash are ordered by market cap, largest first, and only the first ${comparisons.length} are listed here. Say the list is the largest few, never that it is all of them.`,
        }
      : {}),
  };
}

/**
 * A quotable valuation string beside a zatoshi amount, or nothing at all.
 *
 * The caveat lives inside the string, so quoting it verbatim is correct and no paraphrase can drop
 * it. `≈` because a balance times a spot price is a valuation at one instant.
 *
 * The key is omitted when there is no price, never null or zero: a null reads as a figure the model
 * may report, and `$0.00` would state that the addresses hold nothing. The ZEC beside it stays
 * exact either way.
 */
function valueTextFor(zat: unknown, v: Valuation): { valueText?: string } {
  if (v.priceUsd === null || typeof zat !== "number" || !Number.isFinite(zat)) return {};
  return { valueText: formatZatMoneyApprox(zat, v.priceUsd, v.rate, v.currency) };
}

/**
 * The distribution, valued at the spot price, as /rich-list renders it: the transparent total, each
 * balance band, and each of the top-10/100/1,000 shares, so "what do the addresses above 100,000
 * ZEC hold in dollars" has a figure to quote.
 */
export function enrichRichListSummary(payload: unknown, v: Valuation): unknown {
  if (typeof payload !== "object" || payload === null) return payload;
  const p = payload as Record<string, unknown>;
  const withValue = (row: unknown): unknown => {
    if (typeof row !== "object" || row === null) return row;
    const r = row as Record<string, unknown>;
    return { ...r, ...valueTextFor(r.totalZat, v) };
  };
  return {
    ...p,
    ...valueTextFor(p.totalZat, v),
    ...(Array.isArray(p.bands) ? { bands: p.bands.map(withValue) } : {}),
    ...(Array.isArray(p.topShares) ? { topShares: p.topShares.map(withValue) } : {}),
  };
}

/**
 * The node geography without its two grids. The 1° cells draw the map on /network/map; to a model
 * they are tens of KB of coordinates that answer no question the country list does not.
 */
export function withoutGeographyCells(payload: unknown): unknown {
  if (typeof payload !== "object" || payload === null) return payload;
  const p = payload as { data?: Record<string, unknown> };
  if (typeof p.data !== "object" || p.data === null) return payload;
  const { cells: _cells, notAnswering, ...rest } = p.data;
  const silent =
    typeof notAnswering === "object" && notAnswering !== null
      ? { total: (notAnswering as { total?: unknown }).total }
      : notAnswering;
  return { ...p, data: { ...rest, notAnswering: silent } };
}

/**
 * The price and market cap in the reader's currency, plus the echo — or nothing at all for USD.
 *
 * Nothing on the dollar path: the existing keys already are dollars, and a duplicate beside
 * `priceUsd` would hand the model two names for one fact. On a non-dollar turn both are present and
 * `valuation.currency` says which one to quote.
 */
export function priceInCurrency(
  priceUsd: number | null,
  marketCapUsd: number | null,
  v: Valuation,
): Record<string, unknown> {
  if (v.currency === USD) return {};
  const code = v.currency.toUpperCase();
  return {
    priceInCurrency: priceUsd === null ? null : formatMoneyExact(priceUsd * v.rate, v.currency),
    marketCapInCurrency:
      marketCapUsd === null ? null : formatMoneyCompact(marketCapUsd * v.rate, v.currency),
    valuation: {
      currency: v.currency,
      usdToCurrencyRate: v.rate,
      meaning:
        `\`priceInCurrency\` and \`marketCapInCurrency\` are the USD figures above converted by this ` +
        `explorer at the most recent published USD→${code} reference rate. QUOTE THEM and never ` +
        `convert anything yourself. They are a conversion of a dollar price, not a price quoted ` +
        `on a ${code} market — say "about X at today's price and today's reference rate", never ` +
        `"ZEC trades at X on a ${code} exchange".`,
    },
  };
}

/**
 * Replace a window's `groups` with the top buckets for one measure.
 *
 * Ordering happens here, before `capSeries`, and that sequence is the feature. The route returns
 * every bucket in the window, and the display cap that trims a series to its 90 newest points runs
 * afterwards. Rank first and "the busiest day of 2019" is a fact about all 365 days; cap first and
 * it is a fact about whichever 90 came last.
 *
 * The buckets are read defensively rather than cast: this payload comes from an API that deploys
 * separately, so an unrecognised shape leaves the payload untouched and the base note still
 * describes it.
 */
export function withRanking(
  payload: unknown,
  measure: ChainWindowMeasure,
  order: "highest" | "lowest",
  top: number,
): unknown {
  const p = asRecord(payload);
  if (p === null) return payload;
  const groups = p.groups;
  if (!Array.isArray(groups)) return payload;
  const buckets = groups.filter(
    (g): g is ChainWindowBucket =>
      typeof g === "object" &&
      g !== null &&
      typeof (g as { timestamp?: unknown }).timestamp === "number",
  );
  if (buckets.length !== groups.length) return payload;

  const ranked = rankBuckets(buckets, measure, order, top);
  return {
    ...p,
    groups: ranked.ranked,
    ranking: {
      measure: ranked.measure,
      order: ranked.order,
      requested: top,
      returned: ranked.ranked.length,
      // The denominator a share of this ranking would need, which the note tells the model to state when
      // anything was dropped.
      considered: ranked.considered,
      unmeasured: ranked.unmeasured,
      groupsInWindow: groups.length,
      tiedAtTop: ranked.tiedAtTop,
    },
  };
}

/**
 * Replace the per-pool counts' machine-readable absence code with a sentence. A reason code is our
 * vocabulary, and a model will quote it to a reader verbatim ("came back null with reason
 * window-too-wide"). Handing over the finished words leaves no code to quote, which is better than a
 * rule telling it not to.
 */
export function withPoolCountReason(payload: unknown): unknown {
  const p = asRecord(payload);
  if (p === null) return payload;
  const code = p.poolTxCountsUnavailable;
  if (typeof code !== "string") return p;
  const said =
    code === "no-blocks"
      ? "this window covers no block at all, so there is nothing to count in it — a measurement, not a limit"
      : "this explorer's per-pool day totals have not finished building yet, so the count is unavailable right now rather than unknowable — say it is temporarily unavailable and do not offer a shorter period, because the period is not the problem";
  const { poolTxCountsUnavailable: _dropped, ...rest } = p;
  return { ...rest, poolTxCountsUnavailable: said };
}

/**
 * Transactions per second, per bucket: exact where it is exact, and absent where it is not.
 *
 * The model does no division, so the rate is computed here. A complete UTC day is exactly 86,400
 * seconds, so a rate over whole days is exact arithmetic on `daysCovered` and the transaction
 * counts the payload already carries.
 *
 * The current day is partial by construction, so a bucket that includes today gets `null` and a
 * reason, never a smaller number (`/analytics` likewise drops its last daily bucket). A rate we
 * cannot compute is unknown, not slower.
 *
 * `daysCovered` is the denominator rather than the calendar span because a day with no rollup row is
 * a gap, and dividing by days we have no data for would report a quiet chain as a slow one.
 */
export function withThroughput(payload: unknown, nowMs: number): unknown {
  const p = asRecord(payload);
  if (p === null) return payload;
  const todayStart = Date.parse(`${utcDayFromMs(nowMs)}T00:00:00Z`);

  const withRate = (bucket: unknown): unknown => {
    const b = asRecord(bucket);
    if (b === null) return bucket;
    const counts = ["transparentTxs", "mixedTxs", "shieldedTxs"].map((k) =>
      typeof b[k] === "number" ? (b[k] as number) : null,
    );
    const days = typeof b.daysCovered === "number" ? b.daysCovered : null;
    if (counts.some((c) => c === null) || days === null || days <= 0) {
      return { ...b, transactionsPerSecond: null };
    }
    // A bucket is sound only if every day in it has finished. Its timestamp is its first day, so the
    // last day it covers is `timestamp + (days - 1)`.
    const ts = typeof b.timestamp === "number" ? b.timestamp * 1000 : null;
    const lastDayStart = ts === null ? null : ts + (days - 1) * DAY_MS;
    if (lastDayStart === null || lastDayStart >= todayStart) {
      return {
        ...b,
        transactionsPerSecond: null,
        transactionsPerSecondUnknown:
          "this period includes today, which is still in progress — a partial day divided by a whole one would understate the rate",
      };
    }
    const total = counts.reduce<number>((sum, c) => sum + (c ?? 0), 0);
    return {
      ...b,
      // Six decimals: with 75-second blocks the figure is small, and two decimals would print 0.04 for
      // every day of the chain's history.
      transactionsPerSecond: Number((total / (days * DAY_SECONDS)).toFixed(6)),
    };
  };

  return {
    ...p,
    ...(p.totals === undefined ? {} : { totals: withRate(p.totals) }),
    ...(Array.isArray(p.groups) ? { groups: p.groups.map(withRate) } : {}),
  };
}

/**
 * The shielded share of circulating supply, in /v1's `{pct, numerator, denominator}` shape.
 *
 * The denominator is mined minus the lockbox, as `/v1/supply/circulating` publishes and `/shielded`
 * measures against: the lockbox holds deferred subsidy no transaction can spend.
 *
 * Null, never zero, when the payload lacks what the division needs: a share of nothing is not 0%.
 */
function shieldedShareOfCirculating(p: Record<string, unknown>): unknown {
  const shielded = p.shieldedZat;
  const mined = p.minedZat;
  if (typeof shielded !== "number" || typeof mined !== "number") return null;
  const pools = Array.isArray(p.pools) ? p.pools : [];
  const lockbox = pools.find(
    (pool): pool is Record<string, unknown> =>
      typeof pool === "object" &&
      pool !== null &&
      (pool as Record<string, unknown>).pool === "lockbox",
  );
  const lockboxZat = typeof lockbox?.balanceZat === "number" ? lockbox.balanceZat : 0;
  const circulating = mined - lockboxZat;
  const pct = shieldedShareOfCirculatingPct(shielded, circulating);
  if (pct === null) return null;
  return {
    pct: Number(pct.toFixed(2)),
    numerator: shielded,
    denominator: circulating,
    denominatorMeaning: "circulating supply: every ZEC mined, minus the unspendable NU6 lockbox",
  };
}

/**
 * A valuation beside every published pool balance, and beside nothing else.
 *
 * The model may not multiply a balance by a price, and a question left unanswerable gets reasoned
 * around (or answered by denying the balance is public). So the figure is computed here and handed
 * over as a string to quote.
 *
 * The gate is the path, not the shape: a USD figure may sit only beside a genuinely public ZEC
 * amount. A pool total qualifies; an individual shielded amount never can. Keying this to
 * `/v1/supply` means no transaction or address payload can acquire a dollar figure by resembling
 * one, which a duck-typed check on `pools` could not promise.
 */
export function withPoolValues(payload: unknown, v: Valuation): unknown {
  const p = asRecord(payload);
  if (p === null) return payload;
  if (!Array.isArray(p.pools)) return payload;
  const pools = p.pools.map((pool) => {
    const row = asRecord(pool);
    if (row === null) return pool;
    return { ...row, balanceValue: moneyValueOf(row.balanceZat, v) };
  });
  return {
    ...p,
    pools,
    shieldedValue: moneyValueOf(p.shieldedZat, v),
    // The headline on /shielded, computed here because the model may not divide. Shipped with both terms
    // in /v1's percentage shape, so it can be checked rather than taken on trust.
    shieldedShareOfCirculating: shieldedShareOfCirculating(p),
    // Emitted whether or not it holds a figure: a missing key and an explicit null read alike to a reader
    // but behave differently under a spread, and the reason for the null stops it being reported as zero.
    // `currency` is echoed rather than assumed: an older deployment would ignore an unknown currency and
    // value everything in dollars under a euro question, and the echo makes that visible.
    valuation:
      v.priceUsd === null
        ? {
            priceUsd: null,
            currency: v.currency,
            unknowns: { priceUsd: "unmeasured" },
            meaning: NO_USD_VALUATION_MEANING,
          }
        : {
            priceUsd: v.priceUsd,
            currency: v.currency,
            ...(v.currency === USD ? {} : { usdToCurrencyRate: v.rate }),
            meaning: v.currency === USD ? USD_VALUATION_MEANING : valuationMeaning(v.currency),
          },
  };
}

/** A zatoshi balance in the turn's currency, or null when either term is absent. Never a zero. */
function moneyValueOf(zat: unknown, v: Valuation): string | null {
  if (v.priceUsd === null) return null;
  if (typeof zat !== "number" || !Number.isFinite(zat)) return null;
  return formatZatMoneyApprox(zat, v.priceUsd, v.rate, v.currency);
}

/**
 * The pool-usage payload with its per-period points removed, for a question about the period
 * as a whole: the totals answer it, and the points would be the bulk of the payload.
 */
export function withoutPoints(payload: unknown): unknown {
  if (typeof payload !== "object" || payload === null) return payload;
  const p = payload as { data?: Record<string, unknown> };
  if (typeof p.data !== "object" || p.data === null) return payload;
  const { points: _points, ...rest } = p.data;
  return { ...p, data: rest };
}

/**
 * Trailing-window totals over a daily series, computed here so the model is handed a figure to quote
 * instead of summing a column (which it may not do, and which it will otherwise do out loud as the
 * answer).
 *
 * Which topics get them is a per-series judgement:
 *
 *  - `crosschain-volume` and `shielding-flow` are flow series: a day's value happened during that
 *    day, so days add up. Both get windows.
 *  - `transaction-costs` does not. Medians and quartiles do not aggregate: a seven-day median is no
 *    function of seven daily medians. Its sample size already arrives as a total over its own
 *    `windowDays`.
 *  - `ironwood-inflow` does not. Its series is a balance, a level, so summing its points means
 *    nothing; its attribution terms are already all-time totals. (Its windowed `migrations` are a
 *    flow counted in SQL by the route, never a sum of the balance series.)
 */
const TRAILING_WINDOW_DAYS = [7, 30] as const;

interface WindowSpec<F extends string> {
  readonly meaning: string;
  /** Fields summed over each window. Each must be a finite number on every point. */
  readonly fields: readonly F[];
  /** Figures derived from the sums: a subtraction the model may not do. */
  readonly derive?: (sums: Record<F, number>) => Record<string, number>;
}

/**
 * Sum `spec.fields` over each trailing window of a daily series.
 *
 * Returns null when there is nothing to sum, or when any point carries a non-numeric value for a
 * summed field: a sum that silently skipped a null would understate the answer invisibly. These
 * rollups are NOT NULL by construction, so that branch is a guard, and the safe direction is no total.
 */
function trailingTotals<F extends string>(
  points: readonly unknown[],
  spec: WindowSpec<F>,
): Record<string, unknown> | null {
  const rows: { timestamp: number; values: Record<F, number> }[] = [];
  for (const point of points) {
    const row = asRecord(point);
    if (row === null) return null;
    const timestamp = row.timestamp;
    if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) return null;
    const values = {} as Record<F, number>;
    for (const field of spec.fields) {
      const value = row[field];
      if (typeof value !== "number" || !Number.isFinite(value)) return null;
      values[field] = value;
    }
    rows.push({ timestamp, values });
  }
  if (rows.length === 0) return null;

  // The series' own newest point, never `Date.now()`: a clock-anchored cutoff makes the same question
  // select different days at different instants, here a silently wrong total.
  const newest = Math.max(...rows.map((r) => r.timestamp));
  const out: Record<string, unknown> = { meaning: spec.meaning };
  for (const days of TRAILING_WINDOW_DAYS) {
    const window = rows.filter((r) => r.timestamp > newest - days * DAY_SECONDS);
    if (window.length === 0) continue;
    const sums = {} as Record<F, number>;
    for (const field of spec.fields) {
      sums[field] = window.reduce<number>((total, r) => total + r.values[field], 0);
    }
    out[`last${days}Days`] = {
      days,
      daysCovered: window.length,
      fromTimestamp: Math.min(...window.map((r) => r.timestamp)),
      toTimestamp: newest,
      ...sums,
      ...(spec.derive?.(sums) ?? {}),
    };
  }
  return out;
}

/** Gross shielding both ways, plus the net, which is a subtraction, so it is computed here. */
export function enrichShieldingFlow(payload: unknown): unknown {
  if (!Array.isArray(payload)) return payload;
  const totals = trailingTotals(payload, {
    meaning: SHIELDING_WINDOW_MEANING,
    fields: ["shieldedZat", "unshieldedZat"],
    derive: (sums) => ({ netZat: sums.shieldedZat - sums.unshieldedZat }),
  });
  // The bare array is wrapped here, under the key `insightJson` would have used, so the totals sit
  // beside the points they came from.
  return totals === null ? payload : { series: payload, trailingTotals: totals };
}

/**
 * The change across a window of daily closes: the one figure "how has the price moved since last
 * week" needs, and the one the model may not work out (a subtraction and a division).
 *
 * A day with no close is a gap, not a zero and not the previous day carried forward. Rows without a
 * finite `usd` are skipped from the window's endpoints rather than interpolated, and `daysCovered`
 * states how many days the figure rests on, so a window with holes cannot pass as continuous.
 *
 * No figure when the window holds fewer than two closes, or when the opening close is zero: a
 * percentage against a zero denominator is not a change.
 */
export function enrichPrices(payload: unknown): unknown {
  const p = asRecord(payload);
  if (p === null) return payload;
  if (!Array.isArray(p.items)) return payload;

  const closes: { day: string; usd: number; source: string }[] = [];
  for (const item of p.items) {
    const row = asRecord(item);
    if (row === null) return payload;
    if (typeof row.day !== "string" || typeof row.source !== "string") return payload;
    if (typeof row.usd !== "number" || !Number.isFinite(row.usd)) continue;
    closes.push({ day: row.day, usd: row.usd, source: row.source });
  }
  // Rows arrive oldest-first, which is what makes these the two ends of the window.
  const first = closes[0];
  const last = closes.at(-1);
  if (first === undefined || last === undefined || first === last || first.usd === 0) {
    return payload;
  }

  const changeUsd = last.usd - first.usd;
  const changePct = (changeUsd / first.usd) * 100;
  return {
    ...p,
    change: {
      fromDay: first.day,
      fromUsd: first.usd,
      toDay: last.day,
      toUsd: last.usd,
      daysCovered: closes.length,
      changeUsd,
      changeUsdText: signed(formatUsdExact(Math.abs(changeUsd)), changeUsd),
      changePct,
      changePctText: signed(`${Math.abs(changePct).toFixed(1)}%`, changePct),
      // Every aggregator in the window, in order of appearance. Averaging them is forbidden by the note;
      // knowing there are two lets the answer say so.
      sources: [...new Set(closes.map((c) => c.source))],
      meaning: PRICE_CHANGE_MEANING,
    },
  };
}

/** A magnitude with its direction, in ASCII: the model quotes this string verbatim. */
const signed = (text: string, value: number): string => `${value < 0 ? "-" : "+"}${text}`;

/** Transfer counts as well as amounts, so the model never adds counts by hand. */
export function enrichCrosschainVolume(payload: unknown): unknown {
  const p = asRecord(payload);
  if (p === null) return payload;
  if (!Array.isArray(p.daily)) return payload;
  const totals = trailingTotals(p.daily, {
    meaning: CROSSCHAIN_WINDOW_MEANING,
    // Dollars are summed over the window like the counts, and `usdCoveredTransfers` rides along so a
    // partly priced total can be labelled a floor.
    fields: [
      "transfers",
      "inTransfers",
      "outTransfers",
      "inZat",
      "outZat",
      "inUsdAtSwap",
      "outUsdAtSwap",
      "inUsdCoveredTransfers",
      "outUsdCoveredTransfers",
    ],
  });
  return totals === null ? payload : { ...p, trailingTotals: totals };
}

/**
 * A percentage in the shape /v1 publishes its own: the figure and both terms it came from.
 *
 * The model may not divide, so the two headline shares this site publishes would otherwise be
 * unanswerable. They are computed by the site's own domain functions, so the agent cannot disagree
 * with the page it cites, and each carries its denominator because a percentage without one is a
 * claim rather than a measurement.
 */
interface SharePct {
  pct: number;
  numeratorZat: number;
  denominatorZat: number;
  meaning: string;
}

/** The share of Ironwood's balance that is new shielding rather than relocated value. */
export function enrichIronwood(payload: unknown): unknown {
  const inflow = asIronwoodInflow(payload);
  if (inflow === null) return payload;
  const pct = freshShieldingPct(inflow);
  if (pct === null) return payload;
  const share: SharePct = {
    pct,
    numeratorZat: inflow.netFromTransparentZat,
    denominatorZat: inflow.balanceZat,
    meaning:
      "percent of the pool's current balance that was shielded from transparent rather than migrated from another shielded pool. Quote this figure; do not derive one.",
  };
  /**
   * Every source term's share, not just the transparent one. Supplying one share and not the others
   * would make "what ratio of ZEC moved from Orchard to Ironwood?" unanswerable, since the model may
   * not divide `netFromOrchardZat` by `balanceZat` itself.
   */
  const sources = ironwoodSourceShares(inflow);
  return {
    ...(payload as Record<string, unknown>),
    freshShieldingShare: share,
    ...(sources === null
      ? {}
      : {
          sourceShares: {
            denominatorZat: inflow.balanceZat,
            shares: sources.map((s) => ({
              source: s.source,
              zat: s.zat,
              zec: formatZecAmount(s.zat),
              pct: s.pct,
            })),
            meaning:
              "each source term as a percent of the pool's CURRENT balance, computed here. " +
              "'orchard' is the turnstile migration the pool was built for; 'transparent' is " +
              "fresh shielding rather than a migration; 'mined' is ZIP-213 shielded coinbase, " +
              "value that existed nowhere before. Quote a pct; never divide one figure by " +
              "another yourself, and never split a term between pools — nothing here is " +
              "apportioned. A negative pct means that pool took back more than it released.",
          },
        }),
  };
}

/** The headline of "does privacy cost more": the shielded median as a share of transparent. */
export function enrichFees(payload: unknown): unknown {
  const dist = asFeeDistribution(payload);
  if (dist === null) return payload;
  const pct = shieldedVsTransparentPct(dist);
  if (pct === null) return payload;
  const shielded = dist.recent.find((s) => s.kind === "shielded")!;
  const transparent = dist.recent.find((s) => s.kind === "transparent")!;
  const share: SharePct = {
    pct,
    numeratorZat: shielded.medianZat,
    denominatorZat: transparent.medianZat,
    meaning: `percent — the shielded median fee as a share of the transparent one, over the trailing window. Sample sizes: ${shielded.txs} shielded and ${transparent.txs} transparent transactions. Quote this figure; do not derive one.`,
  };
  return { ...(payload as Record<string, unknown>), shieldedVsTransparentShare: share };
}

const numeric = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  keys.every((key) => typeof value[key] === "number" && Number.isFinite(value[key]));

/**
 * Narrow a served payload back to its domain type before handing it to a domain function.
 *
 * The payload crossed an in-process HTTP boundary as JSON text, so the type is gone and a guard
 * restores it (the `isBlock`/`isTransaction` pattern of the Next adapter). A shape change returns
 * null and the derived figure simply does not appear; `tools.test.ts` asserts it does appear for the
 * fixture payload, so a shape change fails a test rather than passing silently.
 */
function asIronwoodInflow(payload: unknown): IronwoodInflow | null {
  const p = asRecord(payload);
  if (p === null) return null;
  const ok =
    numeric(p, [
      "activationHeight",
      "balanceZat",
      "netFromOrchardZat",
      "netFromSaplingZat",
      "netFromSproutZat",
      "netFromTransparentZat",
      "fromTransparentTxCount",
      "minedZat",
      "feesPaidZat",
    ]) && Array.isArray(p.balance);
  return ok ? (p as unknown as IronwoodInflow) : null;
}

function asFeeDistribution(payload: unknown): FeeDistribution | null {
  const p = asRecord(payload);
  if (p === null) return null;
  if (typeof p.windowDays !== "number" || !Array.isArray(p.recent) || !Array.isArray(p.monthly)) {
    return null;
  }
  const statsOk = p.recent.every(
    (row) =>
      typeof row === "object" &&
      row !== null &&
      typeof (row as Record<string, unknown>).kind === "string" &&
      numeric(row as Record<string, unknown>, ["medianZat", "avgZat", "p25Zat", "p75Zat", "txs"]),
  );
  return statsOk ? (p as unknown as FeeDistribution) : null;
}
