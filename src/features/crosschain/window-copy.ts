import type { ChartRange } from "@/domain";
import { CHART_RANGES } from "@/domain";
import { formatCount } from "@/lib/format";

/**
 * How the cross-chain tabs put their time window into words, shared by the flows and protocols
 * pages so both name a window the same way.
 */

/** The chip's own label — "30D", "1Y" — so the column heading and the control read alike. */
export function rangeLabel(range: ChartRange): string {
  return CHART_RANGES.find((r) => r.value === range)?.label ?? "";
}

/**
 * The bare period — "30 days", "year" — for a sentence that supplies its own article. Separate
 * from `windowPhrase` so each sentence adds its own determiner; building one phrase by stripping
 * words off another produces prose like "the previous last year".
 */
export function periodNoun(range: ChartRange): string | null {
  if (range === "all") return null;
  if (range === "1y") return "year";
  const days = CHART_RANGES.find((r) => r.value === range)?.days;
  return days === undefined || days === null ? null : `${days} days`;
}

/**
 * The window in words, or `null` for all-time. Kept here rather than on the shared
 * `CHART_RANGES`: a range's length is domain data, but how a sentence names it is these pages'
 * copy.
 */
export function windowPhrase(range: ChartRange): string | null {
  const noun = periodNoun(range);
  return noun === null ? null : `the last ${noun}`;
}

/**
 * The balance, stated in words: the headline carries the number and the diagram confirms it.
 *
 * It names whichever direction is larger, says "roughly balanced" when the gap is under a tenth,
 * and handles a zero side. Every branch carries the window, because this line is what a
 * screenshot travels with: "no crossings recorded yet" is an all-time claim, and unqualified
 * under a 30-day window it would report a quiet month as an empty history.
 */
export function balanceSentence(outZat: number, inZat: number, range: ChartRange): string {
  const phrase = windowPhrase(range);
  const over = phrase === null ? "" : ` over ${phrase}`;

  if (outZat === 0 && inZat === 0) {
    return phrase === null
      ? "No crossings recorded at these venues yet."
      : `No crossings recorded at these venues in ${phrase}.`;
  }
  if (inZat === 0) return `Every recorded crossing left Zcash${over}; none arrived.`;
  if (outZat === 0) return `Every recorded crossing arrived on Zcash${over}; none left.`;

  const leaving = outZat >= inZat;
  const ratio = leaving ? outZat / inZat : inZat / outZat;
  if (ratio < 1.1) return `ZEC leaves and arrives in roughly equal measure${over}.`;

  const shown = ratio >= 100 ? Math.round(ratio / 10) * 10 : Math.round(ratio * 10) / 10;
  return leaving
    ? `${formatCount(shown)}× more ZEC left Zcash than arrived${over}.`
    : `${formatCount(shown)}× more ZEC arrived on Zcash than left${over}.`;
}
