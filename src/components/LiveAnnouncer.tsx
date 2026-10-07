/**
 * Tells a reader who cannot see rows move that rows moved.
 *
 * New rows carry no visible marker — a row appearing at the top of a list already says it is
 * new — but a screen-reader user hears nothing when the list changes underneath them.
 *
 *  - A count, not per-row text: ten rows arriving at once is one event, not ten interruptions.
 *  - One region per page, combining every feed, so several feeds do not talk over each other.
 *  - `polite`, and the region stays mounted while empty: a live region that appears at the
 *    same instant as its text is often not announced, and `assertive` would interrupt a reader
 *    mid-sentence on every block.
 */

export interface LiveAnnouncerPart {
  count: number;
  /** Singular noun; pluralised here. "block", "transaction", "transfer". */
  noun: string;
}

export interface LiveAnnouncerProps {
  parts: readonly LiveAnnouncerPart[];
}

export function LiveAnnouncer({ parts }: LiveAnnouncerProps) {
  const message = parts
    .filter((p) => p.count > 0)
    .map((p) => `${p.count} new ${p.noun}${p.count === 1 ? "" : "s"}`)
    .join(", ");
  return (
    <span role="status" aria-live="polite" className="sr-only">
      {message}
    </span>
  );
}
