import { DAY_MS, parseUtcDayStart, utcDayFromMs } from "@/domain";
import { USD } from "../../fx-rates";
import { isNarrowed, isZipIndex, narrowZipIndex, zipIndexNarrowing } from "../zip-index";
import { toolArgs, windowDays } from "./args";
import { chainActivityCalls } from "./chain-activity-calls";
import { crossChainCalls } from "./crosschain-calls";
import { enrichRichListTop } from "./enrich";
import {
  ADDRESS_ACTIVITY,
  ADDRESS_VALUE_EXTREMES,
  ANALYTICS_SERIES,
  API_DESCRIPTOR,
  API_DESCRIPTOR_PATH,
  CHAIN_STATUS_FACETS,
  DEFAULT_RECENT_ROWS,
  FACET_AGGREGATES,
  INSIGHT_TOPICS,
  type InsightTopicName,
  MAX_PRICE_DAY_PICKS,
  MAX_PRICE_DAYS,
  MAX_RECENT_ROWS,
  PRICE_FACET_PATHS,
  PRICE_HISTORY,
  PRICE_HISTORY_ON_DAY,
  PRICE_HISTORY_PATH,
  RICH_LIST_MAX_N,
  richListPath,
  SUPPLY_PATH,
  WRAPPED_ZEC_POOLS,
  ZIP_INDEX,
} from "./specs";
import type { AggregateSpec, DispatchedToolName, ToolCall } from "./types";
import { verifyWindowEcho } from "./verify";

/** The fixed path templates. Returns an error string when the arguments do not fit. */
export function callsFor(
  name: DispatchedToolName,
  args: Record<string, unknown>,
  nowMs: number,
  currency: string = USD,
): ToolCall[] | string {
  const v1 = (...paths: string[]): ToolCall[] =>
    paths.map((path) => ({ path, surface: "v1" as const }));
  const read = toolArgs(args);
  const { str, int, flag } = read;
  switch (name) {
    case "lookup_transaction": {
      const txid = str("txid");
      if (txid === null) return "txid must be a non-empty string";
      const enc = encodeURIComponent(txid);
      return v1(`/v1/transactions/${enc}`, `/v1/transactions/${enc}/privacy`);
    }
    case "lookup_block": {
      const id = str("heightOrHash");
      if (id === null) return "heightOrHash must be a non-empty string";
      const enc = encodeURIComponent(id);
      // The transaction list rides alongside the block, never instead of it: the block payload carries
      // `txCount`, the true total, so the capped list cannot be mistaken for the whole block.
      return flag("withTransactions")
        ? v1(`/v1/blocks/${enc}`, `/v1/blocks/${enc}/transactions?limit=${DEFAULT_RECENT_ROWS}`)
        : v1(`/v1/blocks/${enc}`);
    }
    case "lookup_address": {
      const address = str("address");
      if (address === null) return "address must be a non-empty string";
      const enc = encodeURIComponent(address);
      // A shielded address answers 200 with an explanation and no balance, and its transaction list is
      // likewise absent by design; asking anyway is harmless. Deciding here which addresses have a history
      // would duplicate `classifyZcashAddress` outside `domain/`.
      const calls = flag("withTransactions")
        ? v1(`/v1/addresses/${enc}`, `/v1/addresses/${enc}/transactions?limit=${MAX_RECENT_ROWS}`)
        : v1(`/v1/addresses/${enc}`);
      // The extrema ride alongside the summary, never instead of it, so the true balance and lifetime
      // count always frame them. Private surface, since /v1 does not serve this and there is no shielded
      // null to mislabel.
      if (flag("withValueExtremes")) {
        calls.push({
          path: `/chain/addresses/${enc}/value-extremes`,
          surface: "chain",
          aggregate: ADDRESS_VALUE_EXTREMES,
        });
      }

      // A period, alongside the lifetime summary and never instead of it, so the true balance and lifetime
      // count frame the slice and a windowed count cannot read as everything the address ever did.
      const activity = windowDays(read, nowMs);
      if (typeof activity === "string") return activity;
      if ((activity.from === null) !== (activity.to === null)) {
        return `from and to go together — a period needs both ends, and an open-ended one would scan the whole chain rather than the window`;
      }
      if (activity.from !== null && activity.to !== null) {
        const query = new URLSearchParams({ from: activity.from, to: activity.to });
        calls.push({
          path: `/chain/addresses/${enc}/activity?${query.toString()}`,
          surface: "chain",
          aggregate: {
            ...ADDRESS_ACTIVITY,
            // The same guard the chain window carries: a service that ignored an unknown `?from=` would answer
            // about all of history with nothing in its numbers to reveal it.
            verify: (payload) => verifyWindowEcho(payload, activity),
          },
        });
      }
      return calls;
    }
    case "chain_status": {
      const include = args.include;
      if (!Array.isArray(include) || include.length === 0) {
        return "include must be a non-empty array";
      }
      // Surface travels with the path rather than being assumed for the tool: `market` reads the private
      // snapshot of CoinGecko's figures, which `/v1` does not republish.
      const calls: ToolCall[] = [];
      const push = (surface: "v1" | "chain", path: string): void => {
        if (calls.some((c) => c.path === path)) return;
        const aggregate = FACET_AGGREGATES[path];
        calls.push({ path, surface, ...(aggregate ? { aggregate } : {}) });
      };
      for (const facet of include) {
        if (typeof facet !== "string" || !(facet in CHAIN_STATUS_FACETS)) {
          return `unknown facet: ${String(facet)}`;
        }
        const spec = CHAIN_STATUS_FACETS[facet as keyof typeof CHAIN_STATUS_FACETS];
        for (const path of spec.paths) push(spec.surface, path);
      }
      // `/v1/supply` publishes the pool balances and no price, and a balance's valuation must be computed
      // here, not by the model. So the price facet rides along with a supply request that lacks one,
      // costing one in-process request; without it "current USD value of the ironwood pool?" could not be
      // answered.
      //
      // The market facet is deliberately not a price source here: its ZEC price is CoinGecko's and its
      // market cap counts the lockbox, so valuing our own balances with it would mix two sources.
      if (
        calls.some((c) => c.path === SUPPLY_PATH) &&
        !calls.some((c) => PRICE_FACET_PATHS.includes(c.path))
      ) {
        for (const path of CHAIN_STATUS_FACETS.chain.paths) {
          push(CHAIN_STATUS_FACETS.chain.surface, path);
        }
      }
      return calls;
    }
    case "explorer_analytics": {
      const series = str("series");
      if (series === null || !(series in ANALYTICS_SERIES)) {
        return `series must be one of ${Object.keys(ANALYTICS_SERIES).join(", ")}`;
      }
      const spec = ANALYTICS_SERIES[series as keyof typeof ANALYTICS_SERIES];
      // `crosschain-flows` carries caveats of ours (a floor, and a dollar figure that must never be read as
      // a current valuation), so it gets the aggregate treatment: our note above the payload, and a failed
      // read reported as an outage rather than served as an empty set of crossings.
      return [
        {
          path: spec.path,
          surface: "v1",
          aggregate: "aggregate" in spec ? spec.aggregate : undefined,
        },
      ];
    }
    case "explorer_insights": {
      const topic = str("topic");
      // An unrecognised topic is an error the model sees, never a silent default (as /v1 400s an unknown
      // parameter): a default would answer a question nobody asked and look like it answered the real one.
      if (topic === null || !(topic in INSIGHT_TOPICS)) {
        return `topic must be one of ${Object.keys(INSIGHT_TOPICS).join(", ")}`;
      }
      const spec = INSIGHT_TOPICS[topic as InsightTopicName];
      /*
       * The ranked page is the one `alsoRead` whose path the caller can move, so "how much does the 500th
       * largest address hold" is answerable: every holder has a stored rank.
       *
       * `fromRank` is refused on every other topic rather than ignored: silently dropping an argument the
       * model deliberately sent answers the question for a slice nobody asked about.
       */
      const fromRank = int("fromRank");
      const count = int("count");
      if (topic !== "holder-distribution" && (fromRank !== null || count !== null)) {
        return "fromRank and count belong to 'holder-distribution' only";
      }
      if (fromRank !== null && fromRank < 1) {
        return `fromRank is a 1-based rank, so it starts at 1: ${fromRank}`;
      }
      if (count !== null && (count < 1 || count > RICH_LIST_MAX_N)) {
        return `count must be between 1 and ${RICH_LIST_MAX_N}: ${count}`;
      }
      const alsoRead: readonly { path: string; enrich?: AggregateSpec["enrich"] }[] =
        topic === "holder-distribution" && (fromRank !== null || count !== null)
          ? [{ path: richListPath(fromRank, count), enrich: enrichRichListTop }]
          : "alsoRead" in spec
            ? spec.alsoRead
            : [];
      /*
       * The currency rides on the path for this tool. Spot valuations are applied after the fetch, but an
       * at-close valuation uses each record's own day's close at that day's rate, so the conversion has to
       * happen where the day is known: in the SQL. Only `transaction-costs` carries one.
       */
      const topicPath =
        currency === USD || topic !== "transaction-costs"
          ? spec.path
          : `${spec.path}?currency=${encodeURIComponent(currency)}`;
      return [
        { path: topicPath, surface: "chain", aggregate: spec },
        // The same note object by value, so `notesEmitted` (keyed on note text) prints one caveat for the
        // topic however many payloads it fetched. Only the path and the enrichment differ.
        ...alsoRead.map((also): ToolCall => ({
          path: also.path,
          surface: "chain",
          // Built from the note up rather than spread from the parent: an `enrich` written for the summary's
          // shape would run against the ranking's, and an inherited `verify` would check an echo this payload
          // does not carry. The note is the one thing shared, which is what makes it print once.
          aggregate: {
            note: spec.note,
            ...(also.enrich === undefined ? {} : { enrich: also.enrich }),
          },
        })),
        /*
         * The price facet rides along for a topic whose figures this site renders in dollars, as it does for
         * a supply request in `chain_status`. Carried without an `aggregate`, so it renders as its own entity
         * block under its own note rather than inheriting this topic's.
         *
         * `spotPriceUsdFrom` reads it back out of the same call, so the dollar figures are computed here.
         */
        ...("valuesInUsd" in spec && spec.valuesInUsd
          ? CHAIN_STATUS_FACETS.chain.paths.map((path): ToolCall => ({
              path,
              surface: CHAIN_STATUS_FACETS.chain.surface,
            }))
          : []),
      ];
    }
    case "zec_price_history": {
      /*
       * `on`: several named days in one call. Questions like "the price at each pool's launch" name
       * unrelated days spread over a decade, which no window can express (past the 1,000-row cap) and one
       * call per day cannot either (the turn's tool-call budget is 4).
       *
       * Expanded into one in-process request per day rather than a new `/v1` parameter, as `chain_status`
       * turns facets into paths: N requests arrive under one model-visible call and the public contract
       * does not grow a shape only we would use.
       *
       * Capped at `MAX_PRICE_DAY_PICKS`, and each day is round-tripped, because `Date.parse` accepts an
       * impossible day and rolls it over.
       */
      const on = args.on;
      if (on !== undefined) {
        if (args.days !== undefined || args.to !== undefined) {
          return "on names exact days; do not combine it with days or to";
        }
        if (!Array.isArray(on) || on.length === 0) return "on must be a non-empty array of days";
        if (on.length > MAX_PRICE_DAY_PICKS) {
          return `on takes at most ${MAX_PRICE_DAY_PICKS} days; ask for the rest in another call`;
        }
        const picks: string[] = [];
        for (const raw of on) {
          if (typeof raw !== "string") return "every entry in on must be a day as YYYY-MM-DD";
          const d = raw.trim();
          if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
            return `on must hold calendar days written as YYYY-MM-DD, not ${d}`;
          }
          if (parseUtcDayStart(d) === null) return `on holds a day that does not exist: ${d}`;
          // Deduped so two pools launching on one day cannot spend two picks, and sorted so one set of days is
          // one set of cache keys.
          if (!picks.includes(d)) picks.push(d);
        }
        picks.sort();
        return picks.map((d) => ({
          path: `${PRICE_HISTORY_PATH}?from=${d}&to=${d}`,
          surface: "v1" as const,
          aggregate: PRICE_HISTORY_ON_DAY,
        }));
      }
      const days = int("days");
      // Neither mode given. An error rather than a default window: a question about one historical day
      // answered with the last week of closes is a wrong answer that looks right.
      if (days === null && args.days === undefined) {
        return `ask either on: ["YYYY-MM-DD", …] for exact days, or days: <n> for a window`;
      }
      if (days === null) return "days must be a whole number of days";
      if (days < 1 || days > MAX_PRICE_DAYS) return `days must be between 1 and ${MAX_PRICE_DAYS}`;
      const to = str("to");
      if (to !== null && !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        return "to must be a calendar day written as YYYY-MM-DD";
      }
      // The anchor is `to` when given, else yesterday: today's close does not exist yet, so anchoring on
      // today would make every window one day short. A round-trip, not a shape check, validates `to`.
      const toStart = to === null ? null : parseUtcDayStart(to);
      if (to !== null && toStart === null) return `to is not a real calendar day: ${to}`;
      const anchorMs = toStart === null ? nowMs - DAY_MS : toStart * 1000;
      const from = utcDayFromMs(anchorMs - (days - 1) * DAY_MS);
      // `to` is forwarded only when the model asked for one. Otherwise the endpoint's own newest-first cap
      // decides the upper edge, so a row for today, if one exists, is included rather than clipped.
      const query = to === null ? `?from=${from}` : `?from=${from}&to=${encodeURIComponent(to)}`;
      return [{ path: `${PRICE_HISTORY_PATH}${query}`, surface: "v1", aggregate: PRICE_HISTORY }];
    }
    case "site_guide":
      // Only `api` reaches here; the committed sections returned earlier. It gets the aggregate treatment
      // so a failed read is an explicit `<unavailable>`: an empty descriptor would claim this API publishes
      // no endpoints and no limits.
      return [{ path: API_DESCRIPTOR_PATH, surface: "v1", aggregate: API_DESCRIPTOR }];
    case "wrapped_zec_pools":
      // No parameters: the whole matched set is small and capped, so there is nothing to narrow.
      return [{ path: WRAPPED_ZEC_POOLS.path, surface: "chain", aggregate: WRAPPED_ZEC_POOLS }];
    case "zip_index": {
      const narrowing = zipIndexNarrowing(read);
      if (typeof narrowing === "string") return narrowing;
      return [
        {
          path: ZIP_INDEX.path,
          surface: "chain",
          aggregate: {
            ...ZIP_INDEX,
            // A narrowed read that matched nothing is an answer ("ZIP 9999 is not a numbered ZIP"), where an
            // un-narrowed index with no rows would be our tracker broken.
            emptyIsAnAnswer: isNarrowed(narrowing),
            enrich: (payload) =>
              isZipIndex(payload) ? narrowZipIndex(payload, narrowing) : payload,
          },
        },
      ];
    }
    case "crosschain":
      return crossChainCalls(read, nowMs);
    case "chain_activity":
      return chainActivityCalls(read, nowMs, currency);
  }
}
