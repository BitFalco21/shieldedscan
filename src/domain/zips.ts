/**
 * The Zcash Improvement Proposal index: every numbered ZIP, as its own header block states
 * it in github.com/zcash/zips.
 *
 * Title, category and status are third-party text, sanitised at the parse boundary
 * (server/zips.ts) and rendered as text. Links are built from the ZIP number alone, so no
 * string from a fetched file ever becomes part of an href.
 */

/** ZIP 0's status vocabulary. An unknown status renders verbatim, classified below. */
export const ZIP_STATUS_KINDS = [
  "active",
  "final",
  "proposed",
  "draft",
  "reserved",
  "withdrawn",
  "rejected",
  "obsolete",
] as const;

export type ZipStatusKind = (typeof ZIP_STATUS_KINDS)[number];

export interface ZipEntry {
  /** The number from the filename (zip-0213.rst → 213), never from the file's own text. */
  zip: number;
  title: string;
  /**
   * The header's Status line, sanitised but whole. A multi-revision ZIP carries all its
   * revisions in one line ("[Revision 0: Canopy, Revision 1: NU6] Final, ..."); it is not
   * split into per-revision rows, since that format belongs to the ZIP editors.
   */
  status: string;
  /** Derived from `status` for sectioning; "unrecognised" keeps the row visible. */
  statusKind: ZipStatusKind | "unrecognised";
  category: string | null;
  /** YYYY-MM-DD, kept only when it round-trips as a real date. */
  created: string | null;
}

/** Named once so the payload, the page's source line and the tests cannot drift. */
export const ZIP_SOURCE_NAME = "github.com/zcash/zips";

export interface ZipIndex {
  /** Unix seconds the index was read. The page states it. */
  asOf: number;
  source: typeof ZIP_SOURCE_NAME;
  /** Files whose header could not be parsed, so a shrunk index says so. */
  skippedFiles: number;
  /** Sorted ascending by number. */
  zips: ZipEntry[];
}

/**
 * Classify a Status line, matching whole words so "Finalising" is not Final.
 *
 * Checked in ZIP_STATUS_KINDS order, which puts active/final first: a multi-revision line
 * mixing "Final" and "Proposed" is a ZIP with a revision in force, and the section must
 * say so rather than filing a live consensus rule under Proposed.
 */
export function zipStatusKind(status: string): ZipStatusKind | "unrecognised" {
  const lower = status.toLowerCase();
  for (const kind of ZIP_STATUS_KINDS) {
    if (new RegExp(`\\b${kind}\\b`).test(lower)) return kind;
  }
  return "unrecognised";
}

/**
 * The canonical page for a ZIP, from its number alone, zero-padded as zips.z.cash names its
 * pages. This is the only way a ZIP href is built.
 */
export function zipCanonicalUrl(zip: number): string {
  return `https://zips.z.cash/zip-${String(zip).padStart(4, "0")}`;
}

export type ZipSectionId = "in-force" | "proposed" | "draft" | "retired";

export interface ZipSection {
  id: ZipSectionId;
  /** Rendered as the section heading, microlabel-cased by CSS. */
  label: string;
}

/** Render order, matching the canonical index: released first, retired last. */
export const ZIP_SECTIONS: readonly ZipSection[] = [
  { id: "in-force", label: "in force" },
  { id: "proposed", label: "proposed" },
  { id: "draft", label: "draft" },
  { id: "retired", label: "withdrawn / rejected / obsolete" },
];

export function zipSectionOf(kind: ZipStatusKind | "unrecognised"): ZipSectionId {
  switch (kind) {
    case "final":
    case "active":
      return "in-force";
    case "proposed":
      return "proposed";
    case "withdrawn":
    case "rejected":
    case "obsolete":
      return "retired";
    // draft, reserved, and "unrecognised", which stays visible under the heading that
    // claims the least.
    default:
      return "draft";
  }
}

/** How the page may order entries. `number` is the default and the canonical index's order. */
export const ZIP_SORT_ORDERS = ["number", "newest", "oldest"] as const;

export type ZipSortOrder = (typeof ZIP_SORT_ORDERS)[number];

/**
 * Order entries for display, without mutating the input.
 *
 * Date orders sort on the header's Created day. An entry with no Created (e.g. zip-0002 and
 * other Reserved placeholders) sorts last under both date orders, since an unknown date says
 * nothing about age. Ties break by ZIP number for a stable order.
 */
export function sortZips(zips: readonly ZipEntry[], order: ZipSortOrder): ZipEntry[] {
  const byNumber = (a: ZipEntry, b: ZipEntry) => a.zip - b.zip;
  const copy = [...zips];
  if (order === "number") return copy.sort(byNumber);
  return copy.sort((a, b) => {
    if (a.created === null && b.created === null) return byNumber(a, b);
    if (a.created === null) return 1;
    if (b.created === null) return -1;
    if (a.created !== b.created) {
      // ISO YYYY-MM-DD compares correctly as a string; no Date parsing needed.
      return order === "newest"
        ? b.created.localeCompare(a.created)
        : a.created.localeCompare(b.created);
    }
    return byNumber(a, b);
  });
}
