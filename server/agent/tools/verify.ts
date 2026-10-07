import { utcDayFromSeconds, ZATS_PER_ZEC } from "@/domain";
import { USD } from "../../fx-rates";
import { asRecord } from "./json";
import { CROSSCHAIN_THRESHOLD_NOTE, CROSSCHAIN_ZEC_THRESHOLD_NOTE } from "./notes";

/**
 * Echo checks. Each confirms the server applied the narrowing that was asked for: an API one
 * deploy behind ignores an unknown parameter and answers a wider question in a well-formed payload.
 */

/**
 * Why a published series answers a different question than the one asked, or null. Both pool series
 * echo the window, the interval and (pool-usage) the pools in `query`; an older deployment that
 * ignores a parameter answers all of history, or all four pools, as a well-formed payload.
 */
export function verifySeriesEcho(
  payload: unknown,
  days: Record<"from" | "to", string | null>,
  interval: string,
  poolName: string | null,
): string | null {
  const refuse = `THIS READ CANNOT BE USED: the API did not apply the window or pool that was asked for, so these figures answer a different question. Say the figure could not be read, give no number in its place, and do not describe this as a privacy property of Zcash.`;
  if (typeof payload !== "object" || payload === null) return refuse;
  const q = (payload as { query?: Record<string, unknown> }).query;
  if (typeof q !== "object" || q === null) return refuse;
  if ((q.from ?? null) !== days.from || (q.to ?? null) !== days.to || q.interval !== interval) {
    return refuse;
  }
  if (poolName !== null) {
    const applied = q.pool;
    if (!Array.isArray(applied) || applied.length !== 1 || applied[0] !== poolName) return refuse;
  }
  return null;
}

/**
 * Why the transparent payload cannot be described as the answer asked for, or null: the endpoint
 * echoes the window and interval in `query`, and one that differs or is missing answers a different
 * period.
 */
export function verifyTransparentEcho(
  payload: unknown,
  days: Record<"from" | "to", string | null>,
  interval: string,
): string | null {
  const refuse = `THIS READ CANNOT BE USED: the API did not apply the window that was asked for, so these figures answer a different period. Say the figure could not be read, give no number in its place, and do not describe this as a privacy property of Zcash.`;
  if (typeof payload !== "object" || payload === null) return refuse;
  const q = (payload as { query?: { from?: unknown; to?: unknown; interval?: unknown } }).query;
  if (typeof q !== "object" || q === null) return refuse;
  if (q.from !== days.from || q.to !== days.to || q.interval !== interval) return refuse;
  return null;
}

/**
 * Why the miners payload cannot be described as the answer asked for, or null. The endpoint echoes
 * the window and limit in `query`; an echo that differs or is missing (what a deployment without the
 * parameters would send) means a different question.
 */
export function verifyMinersEcho(
  payload: unknown,
  days: Record<"from" | "to", string | null>,
  limit: number,
): string | null {
  const refuse = `THIS READ CANNOT BE USED: the API did not apply the window that was asked for, so these figures answer a different period. Say the figure could not be read, give no number in its place, and do not describe this as a privacy property of Zcash.`;
  if (typeof payload !== "object" || payload === null) return refuse;
  const q = (payload as { query?: { from?: unknown; to?: unknown; limit?: unknown } }).query;
  if (typeof q !== "object" || q === null) return refuse;
  if (q.from !== days.from || q.to !== days.to || q.limit !== limit) return refuse;
  return null;
}

/**
 * Why the window payload cannot be described as the answer to the question asked, or null.
 *
 * Same guard as `crosschain`'s aggregate: a service one deploy behind ignores an unknown `?from=` and
 * answers over all of history — a well-formed aggregate with nothing in its numbers to reveal it. A
 * missing echo fails too, because absence is what an older deployment sends.
 */
export function verifyWindowEcho(
  payload: unknown,
  days: { from: string | null; to: string | null },
  floors: { minValue: number | null; minZec: number | null } = { minValue: null, minZec: null },
  currency = USD,
  migration: { source: string | null; destination: string | null } = {
    source: null,
    destination: null,
  },
): string | null {
  const refuse = (what: string) =>
    `THIS READ CANNOT BE USED: the API did not apply the ${what} that was asked for, so these totals cover a WIDER period than the one put to you — they are not wrong numbers, they are the right numbers to a different question. Say the figure could not be read, give no number in its place, and do not describe this as a privacy property of Zcash.`;

  const a = asRecord(asRecord(payload)?.applied);
  if (a === null) return refuse("window");
  const dayOf = (v: unknown): string | null =>
    typeof v === "number" && Number.isFinite(v) ? utcDayFromSeconds(v) : null;

  if (days.from !== null && dayOf(a.fromTimestamp) !== days.from) {
    return refuse("start of the window");
  }
  if (days.to !== null && dayOf(a.toTimestamp) !== days.to) {
    return refuse("end of the window");
  }
  // A floor that was asked for and is not echoed means the counts are unthresholded: the widest
  // possible answer, well-formed, with nothing in the numbers to reveal it. A missing key fails like a
  // wrong one. The currency is checked with the value: the right number in the wrong denomination is a
  // different threshold.
  const numberOf = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  if (
    floors.minZec !== null &&
    numberOf(a.minCrossingZat) !== Math.round(floors.minZec * ZATS_PER_ZEC)
  ) {
    return refuse("ZEC value floor on shielding and unshielding transactions");
  }
  if (
    floors.minValue !== null &&
    (numberOf(a.minCrossingValue) !== floors.minValue || a.crossingCurrency !== currency)
  ) {
    return refuse("value floor on shielding and unshielding transactions");
  }
  // The migration pair filter's echo. A missing key fails like a wrong one: an older deployment would
  // answer the whole matrix, with no per-period split, under a pair-shaped sentence.
  if (migration.source !== null && a.migrationSource !== migration.source) {
    return refuse("pool-to-pool migration source filter");
  }
  if (migration.destination !== null && a.migrationDestination !== migration.destination) {
    return refuse("pool-to-pool migration destination filter");
  }
  return null;
}

/**
 * Why the aggregate payload cannot be described as the answer to the question asked, or null.
 *
 * Compares the `applied` block the store echoes, term by term, with what this call requested. A
 * stale API that ignores a parameter answers a wider question and says nothing about it (all-time
 * figures under a July heading, every chain under a Bitcoin one). Strict in both directions: a
 * missing echo fails too, because absence is what an older deployment sends.
 */
export function verifyAggregateEcho(
  payload: unknown,
  asked: {
    chain: string | null;
    venue: string | null;
    direction: string | null;
    days: { from: string | null; to: string | null };
    minUsdAtSwap: number | null;
    minZecZat: number | null;
  },
): string | null {
  const refuse = refuseWiderQuestion;

  const a = asRecord(asRecord(payload)?.applied);
  if (a === null) return refuse("narrowing");
  const dayOf = (v: unknown): string | null =>
    typeof v === "number" && Number.isFinite(v) ? utcDayFromSeconds(v) : null;

  if (asked.direction !== null && a.direction !== asked.direction) return refuse("direction");
  if (asked.venue !== null && a.protocol !== asked.venue) return refuse("venue");
  if (asked.chain !== null) {
    const chains = a.counterpartChains;
    const named =
      Array.isArray(chains) && chains.length === 1 && chains[0] === asked.chain
        ? true
        : // The private route maps a single chain onto both directional lists, so either shape
          // counts as applied — what must never pass is the parameter having vanished.
          Array.isArray(a.sourceChains) &&
          Array.isArray(a.destinationChains) &&
          a.sourceChains.includes(asked.chain) &&
          a.destinationChains.includes(asked.chain);
    if (!named) return refuse("chain filter");
  }
  if (asked.days.from !== null && dayOf(a.fromTimestamp) !== asked.days.from) {
    return refuse("start of the window");
  }
  if (asked.days.to !== null && dayOf(a.toTimestamp) !== asked.days.to) {
    return refuse("end of the window");
  }
  /*
   * A missing key fails: the route omits `minUsdAtSwap` when nothing was asked for, so a deployment
   * that predates the threshold would otherwise be indistinguishable from one that applied it, while
   * answering over every crossing under a heading naming a floor.
   */
  if (asked.minUsdAtSwap !== null && a.minUsdAtSwap !== asked.minUsdAtSwap) {
    return refuse("value threshold");
  }
  // Same shape for the ZEC floor.
  if (asked.minZecZat !== null && a.minZecZat !== asked.minZecZat) {
    return refuse("ZEC threshold");
  }
  return null;
}

/**
 * Why a transfer list cannot be described as the answer to the question asked, or null.
 *
 * The two `/v1` transfer routes publish no `applied` block, and the rows are a better witness
 * anyway: each carries the venue's swap-time dollars, so the payload can be checked against the
 * narrowing directly. A row with no price fails too: a route applying the threshold would have
 * excluded it.
 */
export function verifyRowsClearThreshold(
  payload: unknown,
  minUsd: number | null,
  minZecZat: number | null,
): string | null {
  if (typeof payload !== "object" || payload === null) {
    return refuseWiderQuestion("value threshold");
  }
  const items = (payload as Record<string, unknown>).items;
  if (!Array.isArray(items)) return refuseWiderQuestion("value threshold");
  for (const item of items) {
    const row = item as Record<string, unknown> | null;
    const legs = row?.legs as Record<string, unknown> | undefined;
    const zcash = legs?.zcash as Record<string, unknown> | undefined;
    if (minUsd !== null) {
      const usd = zcash?.usdAtSwap;
      if (typeof usd !== "number" || !Number.isFinite(usd) || usd < minUsd) {
        return refuseWiderQuestion("value threshold");
      }
    }
    if (minZecZat !== null) {
      // The DTO carries the exact zatoshi figure; the ZEC decimal beside it is derived from it.
      const zat = row?.zecAmountZat;
      if (typeof zat !== "number" || !Number.isFinite(zat) || zat < minZecZat) {
        return refuseWiderQuestion("ZEC threshold");
      }
    }
  }
  return null;
}

/** The note for a crossings payload, with a threshold caveat appended only when one was asked for. */
export function thresholdNote(
  base: string,
  minUsd: number | null,
  minZecZat: number | null,
): string {
  let note = base;
  if (minUsd !== null) note += CROSSCHAIN_THRESHOLD_NOTE;
  if (minZecZat !== null) note += CROSSCHAIN_ZEC_THRESHOLD_NOTE;
  return note;
}

/**
 * The one wording for "this payload answers a wider question than the one asked", shared by the
 * aggregate's echo check and the transfer list's row check so one failure reads one way.
 * `verifyWindowEcho` keeps its own sentence: a window that was not applied covers a wider period,
 * which is more specific and more useful to say.
 */
const refuseWiderQuestion = (what: string): string =>
  `THIS READ CANNOT BE USED: the API did not apply the ${what} that was asked for, so these figures answer a WIDER question than the one put to you — they are not wrong numbers, they are the right numbers to a different question. Say the figure could not be read, give no number in its place, and do not describe this as a privacy property of Zcash.`;
