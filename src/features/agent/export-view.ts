import {
  exportKey,
  exportQueryString,
  MAX_EXPORTS_PER_ANSWER,
  type DataExportCard,
} from "@/domain";
import { formatCount } from "@/lib/format";
import { apiBaseUrl } from "@/lib/site";

/**
 * How a data-file card is presented: its links, built on this site's own API base from the card's
 * path, and the line that says what the file is. Pure, so the component stays layout.
 */

/**
 * An answer's files with one more off the stream: deduped and capped here as on the server, so a
 * misbehaving stream can neither repeat a file nor fill the turn.
 */
export function withExport(
  cards: readonly DataExportCard[],
  card: DataExportCard,
): DataExportCard[] {
  if (cards.some((c) => exportKey(c) === exportKey(card))) return [...cards];
  return [...cards, card].slice(0, MAX_EXPORTS_PER_ANSWER);
}

/** The file's public URL: the API this site reads, the card's path, its query and `format`. */
export function exportHref(card: DataExportCard, format: "csv" | "json"): string {
  return `${apiBaseUrl}${card.path}?${exportQueryString(card, format)}`;
}

const counted = (n: number, noun: string) => `${formatCount(n)} ${noun}${n === 1 ? "" : "s"}`;

/** "308 rows · 8 columns · through 2026-11-03": only what the API stated. */
export function exportSummary(card: DataExportCard): string {
  return [
    counted(card.rows, card.readOnDownload ? "transaction" : "row"),
    counted(card.columns.length, "column"),
    ...(card.through === null
      ? []
      : [`through ${card.through.replace("T", " ").replace("Z", " UTC")}`]),
    ...(card.through === null && card.height !== null
      ? [`at block ${formatCount(card.height)}`]
      : []),
  ].join(" · ");
}

/** What the reader should know before trusting the file as whole, in a few words each. */
export function exportFlags(card: DataExportCard): string[] {
  return [
    ...(card.readOnDownload ? ["built when you download it, through the newest block"] : []),
    ...(card.paged ? ["one page of a longer list; the file links the next"] : []),
    ...(card.truncated ? ["capped by the API: not the whole window"] : []),
    ...(card.coverage === "partial" ? ["partial — the JSON form says why"] : []),
    ...(card.coverage === "floor" ? ["a floor — the JSON form says why"] : []),
  ];
}

/** Columns whose cells are numbers, set right as the site's tables set them. */
export const NUMERIC_TYPES: ReadonlySet<string> = new Set(["int", "zat", "decimal"]);
