import type { DataExportCard } from "@/domain";
import { AgentExportPreview } from "./AgentExportPreview";
import { exportFlags, exportHref, exportSummary } from "./export-view";

export interface AgentExportProps {
  card: DataExportCard;
}

/**
 * A data file in Zeno's answer: what the file is, its first rows, and the file itself. Everything
 * on it comes from the `export` event, the API's own answer for the call; the links are built here
 * on this site's API base, so a card can name no other host.
 *
 * The CSV link carries `download`, which a browser honours on its own origin; across origins the
 * API's `Content-Disposition: attachment` saves it all the same. The JSON form is read in place, so
 * it opens in a new tab, as every link out of the conversation does.
 */
export function AgentExport({ card }: AgentExportProps) {
  const flags = exportFlags(card);
  return (
    <figure className="mt-4 border border-edge-faint p-3" aria-label={`Data file ${card.fileName}`}>
      <div className="flex items-baseline gap-2">
        <span className="shrink-0 border border-edge px-1 text-xs text-ink-dim">CSV</span>
        <p className="min-w-0 text-sm break-all text-ink-bright">{card.fileName}</p>
      </div>
      <p className="mt-1 text-xs text-ink-dim">{exportSummary(card)}</p>
      {flags.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-xs text-ink-faint">
          {flags.map((flag) => (
            <li key={flag}>
              <span aria-hidden>! </span>
              {flag}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs break-words text-ink-faint">
        Columns: <span className="text-ink-dim">{card.columns.map((c) => c.name).join(", ")}</span>
      </p>
      {card.preview.length > 0 && <AgentExportPreview card={card} />}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <a
          href={exportHref(card, "csv")}
          download={card.fileName}
          className="btn btn-primary inline-flex min-h-11 items-center px-3"
        >
          <span aria-hidden>&gt;&nbsp;</span>download csv
        </a>
        <a
          href={exportHref(card, "json")}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center text-xs text-green hover:underline"
        >
          <span aria-hidden>↗&nbsp;</span>open json
        </a>
      </div>
      <p className="mt-2 flex flex-wrap items-baseline gap-x-2 text-xs text-ink-faint">
        <span className="border border-edge px-1 tracking-wider text-ink-dim uppercase">beta</span>
        <span>Zeno picked the data; the file is this site&apos;s public API.</span>
      </p>
    </figure>
  );
}
