import {
  EXPORT_ABSENCES,
  EXPORT_COLUMN_TYPES,
  EXPORT_COVERAGES,
  isOneOf,
  MAX_PREVIEW_ROWS,
  type ExportColumnType,
  type ExportCoverage,
  type ExportPreviewCell,
} from "@/domain";
import { EXPORTS } from "../../v1/export/registry";
import { fileName, publicUrl } from "../../v1/export/render";
import { cellText, type Cell } from "../../v1/export/table";
import { asRecord, parseJson } from "./json";
import type { ExportTarget } from "./export-targets";

/**
 * A file's preview, read the way MCP reads `/v1`: the same path dispatched in-process with
 * `format=json`, so the columns, the count and the first rows are the export layer's own answer
 * and the file the reader downloads is that answer again. Nothing here computes a value.
 */

export interface PreviewColumn {
  name: string;
  type: ExportColumnType;
  description: string;
}

export interface ExportPreview {
  dataset: string;
  fileName: string;
  columns: PreviewColumn[];
  rows: number;
  preview: ExportPreviewCell[][];
  paged: boolean;
  truncated: boolean;
  through: string | null;
  height: number | null;
  coverage: ExportCoverage | null;
  coverageNotes: string[];
}

/** What a read came back as: a preview, or the API's own reason for refusing (a 4xx). */
export type PreviewRead = { ok: true; preview: ExportPreview } | { ok: false; message: string };

export type ExportReader = (path: string) => Promise<{ status: number; body: string }>;

/** The in-process path the tool reads: the target with `format=json` last. */
export function previewPath(target: ExportTarget): string {
  const q = new URLSearchParams(target.query);
  q.set("format", "json");
  return `${target.path}?${q.toString()}`;
}

/** The query string the public file carries, without `format`. */
export function targetQuery(target: ExportTarget): string {
  return new URLSearchParams(target.query).toString();
}

/** A preview cell as long as a card shows; the file keeps the whole value. */
const MAX_PREVIEW_CELL = 120;

const clip = (s: string) =>
  s.length > MAX_PREVIEW_CELL ? `${s.slice(0, MAX_PREVIEW_CELL - 1)}…` : s;

/**
 * Reads the target. A 4xx is the API's own answer (a window it will not serve), kept with its
 * message; anything else that is not a well-formed file of the right dataset is `null`, so the
 * caller says "unavailable" and offers no file.
 */
export async function readPreview(
  read: ExportReader,
  target: ExportTarget,
): Promise<PreviewRead | null> {
  const spec = EXPORTS[target.pattern];
  if (spec === undefined) return null;
  const path = previewPath(target);
  const res = await read(path);
  if (res.status >= 400 && res.status < 500 && res.status !== 429) {
    const message = asRecord(asRecord(parseJson(res.body))?.error)?.message;
    return {
      ok: false,
      message:
        typeof message === "string" ? message.slice(0, 300) : `the API refused it (${res.status})`,
    };
  }
  if (res.status !== 200) return null;
  const body = asRecord(parseJson(res.body));
  if (body === null || body.dataset !== spec.dataset) return null;
  // The layer echoes the call it answered: anything else is not the file this card would link.
  if (body.request !== publicUrl(`http://in-process${path}`)) return null;
  const columns = readColumns(body.columns);
  const rows = body.rows;
  if (columns === null || !Array.isArray(rows)) return null;
  const unknowns = asRecord(body.unknowns) ?? {};
  const preview: ExportPreviewCell[][] = [];
  for (const [i, raw] of rows.slice(0, MAX_PREVIEW_ROWS).entries()) {
    const row = asRecord(raw);
    if (row === null) return null;
    const cells = columns.map((c) => previewCell(row[c.name], unknowns[`rows.${i}.${c.name}`], c));
    if (cells.some((c) => c === null)) return null;
    preview.push(cells as ExportPreviewCell[]);
  }
  const coverage = asRecord(body.coverage);
  const status = coverage?.status;
  const notes = coverage?.notes;
  return {
    ok: true,
    preview: {
      dataset: spec.dataset,
      fileName: fileName(spec.dataset, `http://in-process${path}`, "csv"),
      columns: columns.map(({ name, type, description }) => ({ name, type, description })),
      rows: rows.length,
      preview,
      paged: typeof body.nextCursor === "string" && body.nextCursor !== "",
      truncated: body.truncated === true,
      through: typeof body.dataThrough === "string" ? body.dataThrough : null,
      height: typeof body.dataHeight === "number" ? body.dataHeight : null,
      coverage: typeof status === "string" && isOneOf(EXPORT_COVERAGES, status) ? status : null,
      coverageNotes: Array.isArray(notes)
        ? notes.filter((n): n is string => typeof n === "string").slice(0, 4)
        : [],
    },
  };
}

interface ReadColumn extends PreviewColumn {
  /** The empty cell is the answer itself, carrying no reason. */
  emptyIsAnswer: boolean;
}

function readColumns(raw: unknown): ReadColumn[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: ReadColumn[] = [];
  for (const item of raw) {
    const c = asRecord(item);
    if (c === null || typeof c.name !== "string" || typeof c.description !== "string") return null;
    if (typeof c.type !== "string" || !isOneOf(EXPORT_COLUMN_TYPES, c.type)) return null;
    out.push({
      name: c.name,
      type: c.type,
      description: c.description,
      emptyIsAnswer: c.empty === "answer",
    });
  }
  return out;
}

/**
 * A cell as the CSV writes it, or its empty cell with the reason the answer gave. A null with no
 * reason on a column that needs one means the answer is not what the layer writes: no preview.
 */
function previewCell(
  value: unknown,
  reason: unknown,
  column: ReadColumn,
): ExportPreviewCell | null {
  if (value === null || value === undefined) {
    if (column.emptyIsAnswer) return { empty: true };
    return typeof reason === "string" && isOneOf(EXPORT_ABSENCES, reason)
      ? { absent: reason }
      : null;
  }
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
    return null;
  }
  const text = cellText(value as Cell);
  return text === null ? null : clip(text);
}
