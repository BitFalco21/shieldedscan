import { formatSharePct } from "@/lib/format";

/**
 * The node map's own formatting, on top of `lib/format`. Nothing here formats an address —
 * nothing on the page has one to format.
 */

/** A share as the page prints it: whole percent from 10% up, one decimal below. */
export function netPct(numerator: number, denominator: number): string {
  if (denominator === 0) return "—";
  const pct = (100 * numerator) / denominator;
  return formatSharePct(pct, pct < 10 ? 1 : 0);
}

/**
 * A network operator's name without its corporate suffix: "DigitalOcean" rather than
 * "DigitalOcean, LLC" in a 9rem column. The full name travels in a `title`.
 */
export function shortAsnOrg(org: string | null): string {
  if (org === null) return "unknown network";
  return org.replace(/,? (LLC|Inc\.?|Ltd\.?|L\.L\.C\.|S\.A\.|SAS|SE|AG|GmbH|B\.V\.)$/i, "").trim();
}

/** "7.2 h" under a day, "3.1 days" from there. */
export function formatWatched(seconds: number): string {
  const hours = seconds / 3600;
  if (hours < 24) return `${hours.toFixed(1)} h`;
  const days = hours / 24;
  return `${days.toFixed(days < 10 ? 1 : 0)} days`;
}

/** "14:32 UTC" from unix seconds. */
export function formatUtcClock(timestamp: number): string {
  return `${new Date(timestamp * 1000).toISOString().slice(11, 16)} UTC`;
}

/** The handshake window in words: 10,800 s → "three hours". */
export function formatWindow(seconds: number): string {
  const hours = seconds / 3600;
  const words = [
    "",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
  ];
  if (Number.isInteger(hours) && hours >= 1 && hours < words.length) {
    return hours === 1 ? "one hour" : `${words[hours]} hours`;
  }
  return hours >= 1 ? `${hours} hours` : `${Math.round(seconds / 60)} minutes`;
}
