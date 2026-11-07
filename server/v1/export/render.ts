import { API_BASE_URL } from "@/api-catalogue/base-url";
import { csvRecord } from "./csv";
import { cellText, type Table } from "./table";

/** The two file formats, and how each is served. */
export const EXPORT_FORMATS = ["csv", "json"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const CONTENT_TYPE: Record<ExportFormat, string> = {
  csv: "text/csv; charset=utf-8; header=present",
  json: "application/json; charset=UTF-8",
};

/** The header row and every record, CRLF-terminated, no BOM, no comment lines. */
export function tableCsv(table: Table): string {
  return [
    csvRecord(table.columns.map((c) => c.name)),
    ...table.rows.map((row) => csvRecord(row.map(cellText))),
  ].join("");
}

/** What the caller asked, as the public URL: the exact call that produced the file. */
export function publicUrl(requestUrl: string): string {
  const u = new URL(requestUrl);
  return `${API_BASE_URL}${u.pathname}${u.search}`;
}

/**
 * A file name fixed by the URL, so the same request always saves under the same name: the
 * dataset, then the parameters in order, each reduced to characters every file system accepts.
 */
export function fileName(dataset: string, requestUrl: string, format: ExportFormat): string {
  const u = new URL(requestUrl);
  const parts = [...u.searchParams.entries()]
    .filter(([k]) => k !== "format")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}-${v}`.replace(/[^A-Za-z0-9._-]+/g, "_"));
  const stem = ["shieldedscan", dataset, ...parts].join("_").slice(0, 160);
  return `${stem}.${format}`;
}

export interface Provenance {
  request: string;
  height: number | null;
  through: string | null;
  asOf: number | null;
}

/** Provenance as response headers. A figure the answer does not state is no header at all. */
export function provenanceHeaders(p: Provenance): Record<string, string> {
  const h: Record<string, string> = { "X-Source": p.request };
  if (p.height !== null) h["X-Data-Height"] = String(p.height);
  if (p.through !== null) h["X-Data-Through"] = p.through;
  if (p.asOf !== null) h["X-As-Of"] = new Date(p.asOf * 1000).toISOString().replace(".000Z", "Z");
  return h;
}

/** The JSON form: the same table, with the context a CSV can only carry in headers. */
export function tableJson(
  dataset: string,
  table: Table,
  p: Provenance,
  context: Record<string, unknown>,
): Record<string, unknown> {
  return {
    dataset,
    request: p.request,
    ...context,
    dataHeight: p.height,
    dataThrough: p.through,
    columns: table.columns.map(({ name, type, description, absent, emptyIsAnswer }) => ({
      name,
      type,
      description,
      empty: emptyIsAnswer ? "answer" : (absent ?? []),
    })),
    rows: table.rows.map((row) =>
      Object.fromEntries(table.columns.map((c, i) => [c.name, row[i] ?? null])),
    ),
    unknowns: table.unknowns,
    asOf: p.asOf,
  };
}
