import type { DataExportCard, ExportPreviewCell } from "@/domain";
import { DataTable } from "@/components/DataTable";
import { Redacted } from "@/components/Redacted";
import { Unmeasured } from "@/components/Unmeasured";
import { NUMERIC_TYPES } from "./export-view";

export interface AgentExportPreviewProps {
  card: DataExportCard;
}

/** One cell as the file holds it; an empty one says why, in the site's grammar. */
function Cell({ cell }: { cell: ExportPreviewCell }) {
  if (typeof cell === "string") return <>{cell}</>;
  // The API's own null, which is the answer (a direction a transaction did not take): blank.
  if ("empty" in cell) return <span className="sr-only">empty</span>;
  // Encrypted on-chain: the Veil. Never spent on an outage of ours, which reads "unavailable".
  if (cell.absent === "shielded") return <Redacted glyphs={4} />;
  if (cell.absent === "unmeasured") return <Unmeasured />;
  return <span className="text-ink-faint">{cell.absent}</span>;
}

/**
 * The file's first rows, exactly as the CSV writes them, in a bounded box that scrolls on its own:
 * a wide file never widens the conversation.
 */
export function AgentExportPreview({ card }: AgentExportPreviewProps) {
  return (
    <div className="mt-2">
      <DataTable
        caption={`First rows of ${card.fileName}`}
        density="compact"
        bounded
        columns={card.columns.map((c) => ({
          label: <span className="whitespace-nowrap">{c.name}</span>,
          ...(NUMERIC_TYPES.has(c.type) ? { align: "right" as const } : {}),
        }))}
      >
        {card.preview.map((row, i) => (
          <tr key={i}>
            {row.map((cell, j) => (
              <td
                key={card.columns[j]!.name}
                className={`whitespace-nowrap ${NUMERIC_TYPES.has(card.columns[j]!.type) ? "text-right tabular-nums" : ""}`}
              >
                <Cell cell={cell} />
              </td>
            ))}
          </tr>
        ))}
      </DataTable>
    </div>
  );
}
