import { classifyZcashAddress } from "./address";
import { isOneOf } from "./closed-set";

/**
 * A data file Zeno offers beneath an answer, as it travels from the API to the console: a public
 * `/v1` path with its query, and what the API's own `format=json` answer said about the file. No
 * host and no free text cross the wire: the console builds the link on its own API base, so a card
 * cannot point anywhere else, and every word on it is derived from closed lists.
 */

/** Column types, as the export layer declares them (`server/v1/export/table.ts`, held by test). */
export const EXPORT_COLUMN_TYPES = ["int", "zat", "decimal", "day", "utc", "text", "bool"] as const;
export type ExportColumnType = (typeof EXPORT_COLUMN_TYPES)[number];

/** Why a cell is empty: `/v1`'s closed `unknowns` vocabulary. */
export const EXPORT_ABSENCES = [
  "shielded",
  "unmeasured",
  "omitted",
  "nonexistent",
  "indeterminate",
] as const;
export type ExportAbsence = (typeof EXPORT_ABSENCES)[number];

export const EXPORT_COVERAGES = ["complete", "partial", "floor"] as const;
export type ExportCoverage = (typeof EXPORT_COVERAGES)[number];

/**
 * A preview cell: the file's text, an empty cell and its reason, or an empty cell that is itself
 * the answer (a transaction's `direction` when it crossed no boundary one way), which has none.
 */
export type ExportPreviewCell = string | { absent: ExportAbsence } | { empty: true };

export interface DataExportCard {
  v: 1;
  /** The dataset's name, as the file is named after it. */
  dataset: string;
  /** A `/v1` path matching one of `EXPORT_PATH_PATTERNS`. */
  path: string;
  /** The query without `format`, in the order the server built it. */
  query: [string, string][];
  /** The CSV's name, as the API's `Content-Disposition` gives it. */
  fileName: string;
  /** Rows in the file (transactions, for an address history). */
  rows: number;
  /** One keyset page of a longer list: the file's `Link` header names the next. */
  paged: boolean;
  /** The answer was capped where the route caps it. */
  truncated: boolean;
  /** Read when the reader downloads it, so no preview and no "through" yet (an address history). */
  readOnDownload: boolean;
  columns: { name: string; type: ExportColumnType }[];
  /** The newest UTC day or instant the rows cover, when the answer states one. */
  through: string | null;
  /** The chain height the rows were read at, when the answer states one. */
  height: number | null;
  coverage: ExportCoverage | null;
  /** The file's first rows, each as wide as `columns`. */
  preview: ExportPreviewCell[][];
}

/** Files one answer may carry, as with charts. */
export const MAX_EXPORTS_PER_ANSWER = 2;
/** Rows a preview shows: enough to see the shape, never a substitute for the file. */
export const MAX_PREVIEW_ROWS = 3;
/** Columns a card may list: above the widest export, below anything a panel could hold. */
export const MAX_EXPORT_COLUMNS = 40;

const TRANSPARENT_SEGMENT = "(t[1-9A-Za-z]{21,41})";

/**
 * The `/v1` paths a card may name, as patterns. The server's targets are held to these by test, and
 * each fixed path to the export registry, so the console accepts exactly what the tool can build.
 */
export const EXPORT_PATH_PATTERNS: readonly RegExp[] = [
  /^\/v1\/analytics\/(pools|pool-usage|migrations|shielding-flow|activity|fees|network|transparent|miners)$/,
  /^\/v1\/prices\/daily$/,
  /^\/v1\/(blocks|transactions|rich-list|reorgs|supply)$/,
  /^\/v1\/blocks\/(\d{1,9}|[0-9a-f]{64})\/transactions$/,
  new RegExp(`^/v1/addresses/${TRANSPARENT_SEGMENT}/export$`),
];

const QUERY_KEY = /^[a-zA-Z]{1,16}$/;
const QUERY_VALUE = /^[A-Za-z0-9._,-]{1,64}$/;
const DATASET = /^[a-z0-9-]{1,40}$/;
const FILE_NAME = /^[A-Za-z0-9._-]{1,170}\.csv$/;
const COLUMN_NAME = /^[a-z0-9_]{1,48}$/;
const THROUGH = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}Z)?$/;
const MAX_CELL_CHARS = 120;

export function isExportPath(path: string): boolean {
  if (!EXPORT_PATH_PATTERNS.some((p) => p.test(path))) return false;
  const address = path.match(/^\/v1\/addresses\/([^/]+)\/export$/)?.[1];
  return address === undefined || classifyZcashAddress(address) === "transparent";
}

/** The query string a card's link carries, `format` last. */
export function exportQueryString(card: Pick<DataExportCard, "query">, format: "csv" | "json") {
  const q = new URLSearchParams(card.query);
  q.set("format", format);
  return q.toString();
}

/** A card's identity: the call it names. Equal keys are one file. */
export function exportKey(card: Pick<DataExportCard, "path" | "query">): string {
  return `${card.path}?${new URLSearchParams(card.query).toString()}`;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function parseCell(raw: unknown): ExportPreviewCell | null {
  if (typeof raw === "string") return raw.length <= MAX_CELL_CHARS ? raw : null;
  if (!isObj(raw)) return null;
  const keys = Object.keys(raw);
  if (keys.length !== 1) return null;
  if (raw.empty === true) return { empty: true };
  return typeof raw.absent === "string" && isOneOf(EXPORT_ABSENCES, raw.absent)
    ? { absent: raw.absent }
    : null;
}

function parseQuery(raw: unknown): [string, string][] | null {
  if (!Array.isArray(raw) || raw.length > 8) return null;
  const out: [string, string][] = [];
  for (const pair of raw as unknown[]) {
    if (!Array.isArray(pair) || pair.length !== 2) return null;
    const [k, v] = pair as unknown[];
    if (typeof k !== "string" || typeof v !== "string") return null;
    if (!QUERY_KEY.test(k) || !QUERY_VALUE.test(v) || k === "format") return null;
    if (out.some(([seen]) => seen === k)) return null;
    out.push([k, v]);
  }
  return out;
}

/**
 * A card off the wire, or null when anything about it is not exactly what the tool builds. Strict
 * on purpose: a card is dropped whole rather than shown half-checked.
 */
export function parseDataExportCard(raw: unknown): DataExportCard | null {
  if (!isObj(raw) || raw.v !== 1) return null;
  const { dataset, path, fileName, rows, paged, truncated, readOnDownload } = raw;
  if (typeof dataset !== "string" || !DATASET.test(dataset)) return null;
  if (typeof path !== "string" || !isExportPath(path)) return null;
  if (typeof fileName !== "string" || !FILE_NAME.test(fileName)) return null;
  if (typeof rows !== "number" || !Number.isSafeInteger(rows) || rows < 0) return null;
  if (typeof paged !== "boolean" || typeof truncated !== "boolean") return null;
  if (typeof readOnDownload !== "boolean") return null;
  const query = parseQuery(raw.query);
  if (query === null) return null;

  const rawColumns = raw.columns;
  if (!Array.isArray(rawColumns) || rawColumns.length === 0) return null;
  if (rawColumns.length > MAX_EXPORT_COLUMNS) return null;
  const columns: DataExportCard["columns"] = [];
  for (const c of rawColumns as unknown[]) {
    if (!isObj(c) || typeof c.name !== "string" || !COLUMN_NAME.test(c.name)) return null;
    if (typeof c.type !== "string" || !isOneOf(EXPORT_COLUMN_TYPES, c.type)) return null;
    columns.push({ name: c.name, type: c.type });
  }

  const { through, height, coverage } = raw;
  if (through !== null && (typeof through !== "string" || !THROUGH.test(through))) return null;
  if (height !== null && (typeof height !== "number" || !Number.isSafeInteger(height))) return null;
  if (coverage !== null && (typeof coverage !== "string" || !isOneOf(EXPORT_COVERAGES, coverage))) {
    return null;
  }

  const rawPreview = raw.preview;
  if (!Array.isArray(rawPreview) || rawPreview.length > MAX_PREVIEW_ROWS) return null;
  // A file read on download has nothing to preview yet; one that was read has its first rows.
  if (readOnDownload && rawPreview.length > 0) return null;
  if (rawPreview.length > rows) return null;
  const preview: ExportPreviewCell[][] = [];
  for (const row of rawPreview as unknown[]) {
    if (!Array.isArray(row) || row.length !== columns.length) return null;
    const cells = (row as unknown[]).map(parseCell);
    if (cells.some((c) => c === null)) return null;
    preview.push(cells as ExportPreviewCell[]);
  }

  return {
    v: 1,
    dataset,
    path,
    query,
    fileName,
    rows,
    paged,
    truncated,
    readOnDownload,
    columns,
    through: through as string | null,
    height: height as number | null,
    coverage: coverage as ExportCoverage | null,
    preview,
  };
}
