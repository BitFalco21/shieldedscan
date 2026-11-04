import type { DataExportCard } from "@/domain";
import { formatCount } from "@/lib/format";
import { addressExport, type AddressRead } from "./export-address";
import type { ExportRequest } from "./export-args";
import type { ExportPreviewCache } from "./export-cache";
import { previewPath, readPreview, type ExportReader, type PreviewRead } from "./export-preview";
import { isExportRefusal, type ExportRefusal } from "./export-refusal";
import { listTarget, seriesTarget } from "./export-targets";
import { DATA_NOTICE } from "./notes";

/**
 * `export_data`'s work once its arguments are valid: find the route, read it in-process through
 * the shared cache, and hand back the card with a description for the model. Every figure on the
 * card is the API's own answer; the model's content carries no link and no rows.
 */

export interface ExportCaches {
  previews: ExportPreviewCache<PreviewRead>;
  addresses: ExportPreviewCache<AddressRead>;
}

export interface ExportOutcome {
  card: DataExportCard;
  content: string;
}

/** Lists move with every block (the edge keeps them ten seconds); series with the hourly rollup. */
const LIST_TTL_MS = 10_000;
const SERIES_TTL_MS = 60_000;

const unavailable: ExportRefusal = {
  reason: "unavailable",
  message:
    "the file could not be read just now, so none was offered — say so, and give no figure in its place",
};

export async function buildExport(
  req: ExportRequest,
  read: ExportReader,
  caches: ExportCaches,
  userText: string,
  nowMs: number,
): Promise<ExportOutcome | ExportRefusal> {
  if (req.kind === "address") {
    const made = await addressExport(req.address, userText, read, caches.addresses);
    if (isExportRefusal(made)) return made;
    return {
      card: made.card,
      content: modelContent(made.card, made.columns, made.hint, [], nowMs),
    };
  }
  const target =
    req.kind === "series" ? seriesTarget(req.spec, req.window, req.interval) : listTarget(req);
  if (isExportRefusal(target)) return target;
  const result = await caches.previews.get(
    previewPath(target),
    target.volatile ? LIST_TTL_MS : SERIES_TTL_MS,
    () => readPreview(read, target),
  );
  if (result === null) return unavailable;
  if (!result.ok) {
    return {
      reason: "bad-parameter",
      message: `the API will not serve that file: ${result.message}`,
    };
  }
  const p = result.preview;
  if (p.rows === 0) {
    return {
      reason: "not-exportable",
      message: "that file would hold no rows: nothing is recorded there — say so in words",
    };
  }
  const card: DataExportCard = {
    v: 1,
    dataset: p.dataset,
    path: target.path,
    query: target.query,
    fileName: p.fileName,
    rows: p.rows,
    paged: p.paged,
    truncated: p.truncated,
    readOnDownload: false,
    columns: p.columns.map(({ name, type }) => ({ name, type })),
    through: p.through,
    height: p.height,
    coverage: p.coverage,
    preview: p.preview,
  };
  return { card, content: modelContent(card, p.columns, target.hint, p.coverageNotes, nowMs) };
}

const counted = (n: number, noun: string) => `${formatCount(n)} ${noun}${n === 1 ? "" : "s"}`;

/**
 * What the model reads: what the file is, in figures it may quote (its rows, its columns, how far
 * it reaches), and the column descriptions. Never the link and never the rows: the card carries
 * both, and a model that has neither cannot retype either wrong.
 */
export function modelContent(
  card: DataExportCard,
  columns: readonly { name: string; type: string; description: string }[],
  hint: string,
  coverageNotes: readonly string[],
  nowMs: number,
): string {
  const facts = [
    `${card.dataset}, ${counted(card.rows, card.readOnDownload ? "transaction" : "row")}, ${counted(card.columns.length, "column")}`,
    ...(card.through === null ? [] : [`data through ${card.through}`]),
    ...(card.height === null ? [] : [`read at block ${formatCount(card.height)}`]),
  ].join(", ");
  const note = [
    `The reader sees a download card beneath your answer: ${facts} (a CSV, with the JSON form beside it).`,
    `What answers the question: ${hint}.`,
    ...(card.readOnDownload
      ? ["The file is built when the reader downloads it, through the newest block then."]
      : []),
    ...(card.paged
      ? ["It is the newest page of a longer list; the file's Link header names the next page."]
      : []),
    ...(card.truncated
      ? ["The API capped this answer; say the file is not the whole window."]
      : []),
    ...(card.coverage === "partial" || card.coverage === "floor"
      ? [`Coverage is ${card.coverage}: ${coverageNotes.join(" ") || "see the file"}`]
      : []),
    "Say in one or two sentences what the file holds, naming columns from the list below. Never write the link, a URL or the rows: the card carries them, with a preview. It is not carried into later turns: to offer it again, call export_data again.",
  ].join(" ");
  const retrievedAt = new Date(nowMs).toISOString();
  const data = JSON.stringify({ columns }, null, 1).replace(/</g, "\\u003c");
  return `<note source="export">\n${note}\n</note>\n<data source="export" retrieved-at="${retrievedAt}">\n${DATA_NOTICE}\n${data}\n</data>`;
}
