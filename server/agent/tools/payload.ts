import { SHIELDED_UPGRADES } from "@/domain";
import { formatUsdExact, formatZecAmount } from "@/lib/format";
import { asRecord, NOT_JSON } from "./json";
import { DATA_NOTICE } from "./notes";
import type { AggregateSpec, Valuation } from "./types";

/**
 * How a fetched payload is prepared for the model: a formatted sibling for every zatoshi amount,
 * count and timestamp, long series windowed with their true length, failed reads stated as
 * failures, and the `<data>` envelope around the result.
 */

/**
 * Points of any one series handed to the model, newest kept.
 *
 * These series grow (the Ironwood balance is hourly and gains 24 points a day), and a turn may call
 * four tools; uncapped, one question would stream tens of thousands of tokens of series into the
 * model twice — once as the tool result and once as the prompt for the answer.
 *
 * 90 is a quarter at day grain, ~3.75 days at hour grain and 7.5 years at month grain: enough to
 * describe a direction and a recent level, which is what the model can honestly do with a series it
 * may not do arithmetic on.
 *
 * The cap travels with the true count: `<key>TotalPoints` and `<key>Withheld` are emitted beside the
 * trimmed array, so a window names its own edges instead of looking whole.
 */
const MAX_SERIES_POINTS = 90;

export function dataBlock(path: string, retrievedAt: string, payload: string): string {
  // Third-party text inside the payload (a coinbase tag, a venue label) must not be able to
  // close this envelope or open a fake one, so no "<" reaches the model unescaped. In JSON the
  // escape is the same string; elsewhere it still reads as the character.
  const inert = payload.replace(/</g, "\\u003c");
  return `<data source="GET ${path}" retrieved-at="${retrievedAt}">\n${DATA_NOTICE}\n${inert}\n</data>`;
}

/**
 * Whether a height is a network-upgrade activation, and which upgrade most recently preceded it —
 * answered here so the model never has to infer it (a model will happily call a block a few heights
 * after an activation "the activation block"). Deleting the inference is a stronger fix than a
 * prompt rule.
 *
 * Heights come from `SHIELDED_UPGRADES`, the same committed consensus values the analytics charts
 * annotate with, so the agent and the charts cannot disagree.
 */
export function upgradeContextFor(height: number): {
  networkUpgradeActivatedAtThisHeight: string | null;
  mostRecentUpgrade: {
    label: string;
    activationHeight: number;
    blocksAfterActivation: number;
  } | null;
} {
  const exact = SHIELDED_UPGRADES.find((u) => u.height === height);
  // Highest activation at or below this height. Null before the first one rather than a nearest match:
  // "the upgrade before Sapling" does not exist, and naming one would be a fabrication.
  const preceding = SHIELDED_UPGRADES.filter((u) => u.height <= height).sort(
    (a, b) => b.height - a.height,
  )[0];
  return {
    networkUpgradeActivatedAtThisHeight: exact?.label ?? null,
    mostRecentUpgrade: preceding
      ? {
          label: preceding.label,
          activationHeight: preceding.height,
          blocksAfterActivation: height - preceding.height,
        }
      : null,
  };
}

/**
 * An aggregate payload, prepared for the model: derived figures added, long series windowed with
 * their true length beside them, then every zatoshi and timestamp given a pre-formatted sibling as
 * an entity payload gets.
 *
 * Order matters. Enrichment runs on the payload as served, so domain functions read the same numbers
 * the page does; the cap runs next so formatting skips points nobody sees; formatting runs last so
 * the added figures get siblings too.
 */
export function insightJson(parsed: unknown, spec: AggregateSpec, valuation: Valuation): string {
  const enriched = spec.enrich?.(parsed, valuation) ?? parsed;
  // A bare series is wrapped so the trimming counts have somewhere to live beside it.
  const shaped = Array.isArray(enriched) ? { series: enriched } : enriched;
  return JSON.stringify(withFlowUsdText(withFormattedZec(capSeries(shaped))), null, 2);
}

/**
 * A quotable dollar string wherever a swap-time USD total sits beside its own coverage.
 *
 * The model may not do arithmetic, so a bare `usdAtSwap: 419064.86` could only be reported without
 * the caveat that makes it honest. This puts the caveat inside the string ("≥ $419,064.86"), so
 * quoting it verbatim is correct.
 *
 * Three states:
 *  - full coverage → a plain figure;
 *  - partial → the `≥` the /cross-chain cards use, so page and agent phrase a floor the same way;
 *  - no coverage → null, never "$0.00". No venue in that group published a price, which is an
 *    absence of prices, not a measurement of zero.
 *
 * Gated on all three fields being finite siblings, so it cannot wander onto an unrelated object.
 * `formatUsdExact` rather than a compact form: these are the venues' own published sums, which a
 * reader may check verbatim.
 *
 * Three prefixes, because a payload may carry a combined figure, a per-direction pair, or both.
 * One combined dollar total beside direction-split ZEC invites the model to reconcile them out loud.
 */
function withFlowUsdText(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withFlowUsdText);
  if (typeof value !== "object" || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    out[key] = withFlowUsdText(raw);
  }
  const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
  for (const [usd, covered, total, text] of [
    ["usdAtSwap", "usdCoveredTransfers", "transfers", "usdAtSwapText"],
    ["inUsdAtSwap", "inUsdCoveredTransfers", "inTransfers", "inUsdAtSwapText"],
    ["outUsdAtSwap", "outUsdCoveredTransfers", "outTransfers", "outUsdAtSwapText"],
  ] as const) {
    if (!finite(out[usd]) || !finite(out[covered]) || !finite(out[total])) continue;
    out[text] =
      out[covered] === 0
        ? null
        : `${out[covered] < out[total] ? "≥ " : ""}${formatUsdExact(out[usd])}`;
  }
  return out;
}

/** Window every over-long array to its newest `MAX_SERIES_POINTS`, counts included. */
function capSeries(value: unknown): unknown {
  const record = asRecord(value);
  if (record === null) return value;
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(record)) {
    if (!Array.isArray(raw) || raw.length <= MAX_SERIES_POINTS) {
      out[key] = raw;
      continue;
    }
    out[key] = raw.slice(-MAX_SERIES_POINTS);
    out[`${key}TotalPoints`] = raw.length;
    out[`${key}Withheld`] =
      `showing the ${MAX_SERIES_POINTS} most recent of ${raw.length} points, ordered OLDEST FIRST — so the newest rows are at the END of the array and the most recent N are its LAST N, never its first. The oldest ${raw.length - MAX_SERIES_POINTS} points are not in this result. Say which window you are describing, and never present it as the whole series — the full series is on the page cited beneath your answer.`;
  }
  return out;
}

/**
 * Why this aggregate read cannot be reported as data, or null when it can.
 *
 * A non-2xx, a body that is not JSON, and a payload with no points collapse to one message. An
 * empty series is not a measurement that nothing happened; it is a rollup not yet refreshed or a
 * database that answered without data, and `[]` reaching the model would let it claim Zcash has no
 * shielding history.
 *
 * The message tells the model there is no figure and that this is our read failing, not a privacy
 * property of Zcash.
 */
export function unreadableAggregate(
  status: number,
  parsed: unknown,
  upstream = "the explorer's own analytics API",
  emptyIsAnAnswer = false,
): string | null {
  const failed = (why: string) =>
    `THIS READ FAILED: ${why}. These figures are UNAVAILABLE right now. Say plainly that the read failed and supply no number in its place. This is a DATA READ failing — an outage on our side or at a source we read — and it is NOT a privacy property of Zcash, so do not describe it as one.`;
  if (status < 200 || status >= 300) {
    return failed(`${upstream} answered HTTP ${status}`);
  }
  if (parsed === NOT_JSON) return failed(`${upstream} answered with something that is not JSON`);
  // A narrowed read inverts the emptiness rule, and the two cases look identical on the wire: an empty
  // shielding-flow series means our rollup is broken, while an empty slice of crossings is a
  // measurement.
  if (!emptyIsAnAnswer && isEmptyAggregate(parsed)) {
    return failed(`${upstream} returned no data points at all`);
  }
  return null;
}

/**
 * Whether a payload carries no series at all.
 *
 * An object counts as empty when it has at least one array field and all are empty, which catches
 * `{recent: [], monthly: []}` while leaving a payload with one populated series alone. It also calls
 * the Ironwood payload unreadable when its balance series is empty even though its scalar terms are
 * present; that errs toward "we could not read this", the safe direction.
 */
function isEmptyAggregate(parsed: unknown): boolean {
  if (parsed === null || parsed === undefined) return true;
  if (Array.isArray(parsed)) return parsed.length === 0;
  if (typeof parsed !== "object") return false;
  const values = Object.values(parsed as Record<string, unknown>);
  if (values.length === 0) return true;
  const arrays = values.filter(Array.isArray);
  return arrays.length > 0 && arrays.every((a) => a.length === 0);
}

/**
 * Give every zatoshi field a pre-formatted ZEC sibling, so the model never does the conversion.
 *
 * Unit conversion is where a model makes its most damaging errors (130,000 zatoshis is 0.0013 ZEC,
 * not 1.3). Asking it to be careful is the weak fix; removing the arithmetic from its job is the
 * strong one. `feeZat: 130000` arrives beside `feeZec: "0.0013"`, formatted by the same
 * `formatZecAmount` the pages use, so the agent quotes a string we computed and cannot disagree with
 * the page it cites.
 *
 * A null stays null and gains no sibling: "0.00" for an unknown fee would be a fabrication.
 */
export function withFormattedZec(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withFormattedZec);
  if (typeof value !== "object" || value === null) return value;

  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    out[key] = withFormattedZec(raw);
    if (key.endsWith("Zat") && typeof raw === "number" && Number.isFinite(raw)) {
      // `…Zat` → `…Zec`, next to its source so the pairing is unmissable.
      out[`${key.slice(0, -3)}Zec`] = formatZecAmount(raw);
    }
    const utc = utcSibling(key, raw);
    if (utc !== null) out[`${key}Utc`] = utc;
    const grouped = groupedSibling(key, raw);
    if (grouped !== null) out[`${key}Grouped`] = grouped;
  }
  // A block's own height gets its upgrade context attached. Gated on `hash` too, so an unrelated object
  // with a `height` (a supply reading, a cursor) does not acquire consensus annotations.
  if (typeof out.height === "number" && typeof out.hash === "string") {
    Object.assign(out, upgradeContextFor(out.height));
  }
  return out;
}

/** Keys whose integer value is a COUNT of things — the figures a model restates with separators. */
const COUNT_KEY =
  /(?:Count|Txs|Transactions|Blocks|Actions|Transfers|Requests|Rows|Addresses|Holders|Considered|Covered)$/;

/**
 * A grouped string beside a large count: `txCount: 1410990` gains `txCountGrouped: "1,410,990"`.
 *
 * A model transcribing a bare integer into a grouped one occasionally inserts a digit (1,410,990 →
 * 14,109,990), so counts are handed over pre-formatted like every other figure (`…Zec`, `…Utc`,
 * `valueUsdText`). Gated on the key name as well as the value: a height is an integer too, and
 * grouping one would invite quoting "3,428,150" as a count. Below 1,000 there is nothing to group.
 * Not a `…Text` suffix: `routing-coverage` treats those as quantities needing a routing word, and
 * this is the same quantity re-spelled.
 */
export function groupedSibling(key: string, raw: unknown): string | null {
  if (!COUNT_KEY.test(key) || typeof raw !== "number" || !Number.isInteger(raw)) return null;
  if (Math.abs(raw) < 1_000) return null;
  return raw.toLocaleString("en-US");
}

/**
 * The ISO form of a unix-seconds field, or null when the field is not one.
 *
 * Same reasoning as the ZEC siblings: a model reads an epoch back verbatim ("mined at 1785247959")
 * or converts it wrongly. Gated on the field name as well as a plausible range, because a height, a
 * version and a count are integers too, and a fabricated `"heightUtc"` beside a real figure would be
 * worse than the raw integer.
 */
function utcSibling(key: string, raw: unknown): string | null {
  const named = key === "timestamp" || key === "asOf" || /(?:Timestamp|At|Time)$/.test(key);
  if (!named || typeof raw !== "number" || !Number.isInteger(raw)) return null;
  // 2001-09-09 to 2033-05-18 in unix seconds: wide enough for any chain timestamp, narrow enough that a
  // height or a byte count cannot wander in.
  if (raw < 1_000_000_000 || raw > 2_000_000_000) return null;
  return new Date(raw * 1_000).toISOString();
}
