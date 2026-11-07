import type { ToolResult } from "./types";

/**
 * A file the tool will not offer, said so it can be passed on usefully: why (a closed reason the
 * model can phrase), the closest export it CAN offer as ready-made arguments, and, where the answer
 * is the open dataset, that dataset as a source link beneath the answer, so the model never writes
 * a link itself.
 */

export const EXPORT_REFUSAL_REASONS = [
  /** Outside every family, or a series with no file on `/v1` (transparent supply over time). */
  "not-exportable",
  /** Cross-chain data, held back as a file by policy. */
  "policy",
  /** A value outside its list, a missing parameter, an unknown argument. */
  "bad-parameter",
  /** Parameters that name no series. */
  "names-nothing",
  /** Before launch, in the future, empty, or longer than the file holds. */
  "window",
  /** A shielded address, or one the reader did not type. */
  "per-address",
  /** More rows than one request may hold: the open dataset has them. */
  "too-large",
  /** The API answered something other than a file just now. */
  "unavailable",
  /** The answer already carries the most files one answer may. */
  "export-limit",
] as const;
export type ExportRefusalReason = (typeof EXPORT_REFUSAL_REASONS)[number];

export interface ExportRefusal {
  reason: ExportRefusalReason;
  message: string;
  /** Argument sets the tool can offer instead, nearest first. */
  closest?: Record<string, unknown>[];
  /** Point the reader at the open dataset, cited beneath the answer. */
  openDataset?: true;
}

/** The citation the open dataset travels as; `sourceLinkFor` turns it into the dataset's page. */
export const OPEN_DATASET_SOURCE = "site:open-dataset";

const ADVICE =
  "Say in words why there is no file. Offer the closest export above — and make it if it answers the question. Never write a link, a URL or a query for the reader, and give no figure the tool did not return.";

export const isExportRefusal = (v: unknown): v is ExportRefusal =>
  typeof v === "object" && v !== null && "reason" in v && "message" in v;

export function exportRefusalResult(r: ExportRefusal): ToolResult {
  const lines = [
    r.message,
    ...(r.closest ?? []).map((args) => `closest: export_data ${JSON.stringify(args)}`),
    ...(r.openDataset
      ? ["The open dataset is linked beneath your answer; point the reader to it."]
      : []),
    ADVICE,
  ];
  return {
    content: `<refusal source="export" reason="${r.reason}">\n${lines.join("\n")}\n</refusal>`,
    endpoints: r.openDataset ? [OPEN_DATASET_SOURCE] : [],
  };
}
