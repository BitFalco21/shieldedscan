import type { PulseEvent } from "@/domain";
import { pulseLogLine } from "./pulse-text";

/**
 * The written record of what moved, newest first.
 *
 * The primary record under reduced motion, and what a no-JavaScript reader gets (the server
 * renders the newest block's movements into it), so every row states the movement, amount and
 * caveat in full.
 *
 * A row never says "sent to": choosing which output was the payment and which was change is
 * chain analysis this site does not do. Each row carries its `blockHash`, so a reorg discards
 * exactly the rows it invalidated.
 */

/** How many rows the list keeps. Past this a reader wants the block pages, not more rows. */
export const PULSE_LOG_ROWS = 9;

/**
 * One row, either a movement or something about the block the movements came from. The `note`
 * shape is what a capped or collapsed block gets: a block that handed over 300 of its 2,450
 * movements cannot say so on any one of them, and a collapsed block's shielded and unsettled
 * movements have no amount, so they are counted here rather than dropped.
 */
export type PulseLogEntry =
  | {
      row: "movement";
      /** Unique per drawn row: one movement can be drawn twice across a replay and a live pass. */
      key: string;
      event: PulseEvent;
      /** The instant to stamp — the replayed block's time in replay, not the wall clock. */
      atSeconds: number;
      colorClass: string;
    }
  | {
      row: "note";
      key: string;
      /** Kept so a reorg can discard exactly the rows it invalidated. */
      blockHash: string | null;
      text: string;
      atSeconds: number;
      colorClass: string;
    };

export interface PulseLogProps {
  entries: readonly PulseLogEntry[];
}

const hhmmss = (seconds: number): string => new Date(seconds * 1000).toISOString().slice(11, 19);

export function PulseLog({ entries }: PulseLogProps) {
  if (entries.length === 0) {
    return <p className="text-sm text-ink-faint">No movements drawn yet.</p>;
  }
  return (
    <ol className="grid gap-1.5 text-xs">
      {entries.slice(0, PULSE_LOG_ROWS).map((entry) => {
        const line = entry.row === "movement" ? pulseLogLine(entry.event) : null;
        return (
          <li
            key={entry.key}
            // The Veil means encrypted on-chain and nothing else, so `e2e/pulse.spec.ts` holds
            // the number of redaction bars on the page to the number of rows marked here.
            data-shielded={line?.shielded === true ? "true" : undefined}
            data-block-hash={
              (entry.row === "movement" ? entry.event.blockHash : entry.blockHash) ?? undefined
            }
            className="grid grid-cols-[62px_1fr] gap-3 text-ink-dim tabular-nums"
          >
            <time
              dateTime={new Date(entry.atSeconds * 1000).toISOString()}
              className="text-ink-faint"
            >
              {hhmmss(entry.atSeconds)}
            </time>
            <span className="min-w-0">
              <span className={`pulse-dot ${entry.colorClass}`} aria-hidden />
              {entry.row === "note" ? (
                <span className="text-ink-faint">{entry.text}</span>
              ) : line === null ? null : (
                <>
                  {line.shielded ? (
                    <span
                      className="redact"
                      role="img"
                      aria-label="value shielded — encrypted on-chain"
                      title="hidden by design — encrypted on-chain"
                    >
                      ▓▓▓▓▓▓
                    </span>
                  ) : line.amount === null ? null : (
                    <span className="text-ink">{line.amount}</span>
                  )}{" "}
                  <span>{line.text}</span>{" "}
                  {line.kind ? <span className="text-ink-faint">· {line.kind}</span> : null}
                </>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
