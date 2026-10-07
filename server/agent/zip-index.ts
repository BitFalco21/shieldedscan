// The `zip_index` tool's own half: turning the tracker's whole index into the labels a question
// asked for, sectioned the way /zips sections them.
//
// Labels only — number, title, category, status, created day — never a ZIP's text. A header field
// is a short label sanitised at the parse boundary; a paragraph of third-party prose is
// indistinguishable from an instruction by shape. A content question gets the canonical link,
// derived from the number alone.
//
// Narrowing happens here rather than on the route, so `/chain/zips` keeps one cache key and the
// filter has a single implementation.

import type { ToolArgs } from "./tools/args";
import {
  ZIP_SECTIONS,
  type ZipEntry,
  type ZipIndex,
  type ZipSectionId,
  zipCanonicalUrl,
  zipSectionOf,
} from "@/domain";

export const ZIP_SECTION_IDS: readonly ZipSectionId[] = ZIP_SECTIONS.map((s) => s.id);

/** How many characters of a title-substring query are honoured; the rest is dropped, not erred. */
export const MAX_ZIP_QUERY_CHARS = 64;

/**
 * How many ZIP numbers one call may name.
 *
 * A list, so one model-visible call can look up every ZIP an upgrade deploys without exhausting
 * the turn's tool-call budget. Twenty covers any upgrade's list and keeps one call from becoming a
 * listing of the whole index by another name.
 */
export const MAX_ZIP_PICKS = 20;

export interface ZipIndexNarrowing {
  /** ZIPs by number — one or several, sorted and deduplicated. */
  readonly zip: readonly number[] | null;
  /** One of the page's four sections. */
  readonly section: ZipSectionId | null;
  /** A case-insensitive substring of the title. */
  readonly query: string | null;
}

export const NO_NARROWING: ZipIndexNarrowing = { zip: null, section: null, query: null };

/**
 * `zip_index`'s arguments, or the error the model should see. Every rejection is a message rather
 * than a silent default: an unknown section, dropped, would answer the whole index under a sentence
 * about drafts.
 */
export function zipIndexNarrowing(args: ToolArgs): ZipIndexNarrowing | string {
  const { str } = args;
  const zipArg = args.raw.zip;
  let zip: number[] | null = null;
  if (zipArg !== undefined && zipArg !== null) {
    // A bare number is accepted and means `[n]`. Each item gets the same whole-number check.
    const raw: unknown[] = Array.isArray(zipArg) ? zipArg : [zipArg];
    if (raw.length === 0) return "zip must name at least one ZIP number, e.g. [213]";
    if (raw.length > MAX_ZIP_PICKS)
      return `zip names at most ${MAX_ZIP_PICKS} ZIPs per call; split the list or omit zip to list them all`;
    const picks: number[] = [];
    for (const item of raw) {
      const n =
        typeof item === "number" ? item : typeof item === "string" ? Number(item.trim()) : NaN;
      if (!Number.isInteger(n) || n < 0)
        return "each zip must be a non-negative whole number, e.g. 213";
      picks.push(n);
    }
    zip = [...new Set(picks)].sort((a, b) => a - b);
  }
  let section: ZipIndexNarrowing["section"] = null;
  const rawSection = str("section");
  if (rawSection !== null) {
    const found = ZIP_SECTION_IDS.find((id) => id === rawSection);
    if (found === undefined) return `section must be one of ${ZIP_SECTION_IDS.join(", ")}`;
    section = found;
  }
  const rawQuery = str("query");
  const query = rawQuery === null ? null : rawQuery.slice(0, MAX_ZIP_QUERY_CHARS);
  if (zip === null && section === null && query === null) return NO_NARROWING;
  return { zip, section, query };
}

export function isNarrowed(n: ZipIndexNarrowing): boolean {
  return n.zip !== null || n.section !== null || n.query !== null;
}

/** One row as the model reads it. `url` is derived from the NUMBER, never from fetched text. */
export interface ZipIndexRow {
  readonly zip: number;
  readonly title: string;
  readonly category: string | null;
  readonly status: string;
  readonly created: string | null;
  readonly url: string;
}

export interface ZipIndexPayload {
  readonly source: string;
  readonly asOf: number;
  readonly asOfUtc: string;
  readonly skippedFiles: number;
  /** Every numbered ZIP the index holds — the denominator for any narrowed count. */
  readonly zipsIndexed: number;
  readonly narrowing: ZipIndexNarrowing | "none";
  readonly matched: number;
  /**
   * Numbers the call asked for that the index does not hold, or absent when no number was asked.
   *
   * Named rather than left to subtraction, so a model never reports an existing ZIP as missing by
   * diffing two lists by eye. Absent, not `[]`, when no numbers were named: `[]` would state that
   * every requested number was found.
   */
  readonly notIndexed?: readonly number[];
  readonly sections: {
    readonly inForce: readonly ZipIndexRow[];
    readonly proposed: readonly ZipIndexRow[];
    readonly draft: readonly ZipIndexRow[];
    readonly retired: readonly ZipIndexRow[];
  };
}

/**
 * Shape check on the route's body — the version-skew tripwire, deliberately shallow: the API is
 * ours. Anything else is handed back untouched so the loop's generic path reports it.
 */
export function isZipIndex(value: unknown): value is ZipIndex {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.asOf === "number" &&
    typeof v.source === "string" &&
    typeof v.skippedFiles === "number" &&
    Array.isArray(v.zips) &&
    v.zips.every(
      (z: unknown) =>
        typeof z === "object" &&
        z !== null &&
        typeof (z as ZipEntry).zip === "number" &&
        typeof (z as ZipEntry).title === "string" &&
        typeof (z as ZipEntry).status === "string" &&
        typeof (z as ZipEntry).statusKind === "string",
    )
  );
}

function matches(z: ZipEntry, n: ZipIndexNarrowing): boolean {
  if (n.zip !== null && !n.zip.includes(z.zip)) return false;
  if (n.section !== null && zipSectionOf(z.statusKind) !== n.section) return false;
  if (n.query !== null && !z.title.toLowerCase().includes(n.query.toLowerCase())) return false;
  return true;
}

const row = (z: ZipEntry): ZipIndexRow => ({
  zip: z.zip,
  title: z.title,
  category: z.category,
  status: z.status,
  created: z.created,
  url: zipCanonicalUrl(z.zip),
});

/**
 * The payload the model reads. Sectioned exactly as /zips is, so an answer and the page cannot
 * file one ZIP under two headings; a narrowing that matches nothing yields empty sections and
 * `matched: 0`, which the caller marks as an ANSWER rather than an outage.
 */
export function narrowZipIndex(index: ZipIndex, n: ZipIndexNarrowing): ZipIndexPayload {
  const sections = { inForce: [], proposed: [], draft: [], retired: [] } as {
    inForce: ZipIndexRow[];
    proposed: ZipIndexRow[];
    draft: ZipIndexRow[];
    retired: ZipIndexRow[];
  };
  let matched = 0;
  for (const z of index.zips) {
    if (!matches(z, n)) continue;
    matched += 1;
    const r = row(z);
    switch (zipSectionOf(z.statusKind)) {
      case "in-force":
        sections.inForce.push(r);
        break;
      case "proposed":
        sections.proposed.push(r);
        break;
      case "draft":
        sections.draft.push(r);
        break;
      case "retired":
        sections.retired.push(r);
        break;
    }
  }
  const held = new Set(index.zips.map((z) => z.zip));
  return {
    source: index.source,
    asOf: index.asOf,
    asOfUtc: new Date(index.asOf * 1000).toISOString(),
    skippedFiles: index.skippedFiles,
    zipsIndexed: index.zips.length,
    narrowing: isNarrowed(n) ? n : "none",
    matched,
    ...(n.zip === null ? {} : { notIndexed: n.zip.filter((z) => !held.has(z)) }),
    sections,
  };
}
