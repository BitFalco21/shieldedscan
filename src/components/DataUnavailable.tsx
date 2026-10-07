export interface DataUnavailableProps {
  /** What could not be read, in the reader's terms — "the monthly series", not "getMonthlySeries". */
  what: string;
  /** Roughly how soon it refreshes itself, so the reader knows not to do anything. */
  refreshesWithin: string;
}

/**
 * A panel saying we could not read something, in words.
 *
 * The page-level sibling of `Unmeasured`: an empty series would draw a chart showing Zcash as
 * having no history. A blank chart is a claim; "we could not read this right now" is a fact.
 * The Veil is not used here — redaction bars mean "encrypted on-chain, hidden by design", not
 * an outage of ours.
 *
 * These pages revalidate on a timer, so the next successful render replaces this panel.
 */
export function DataUnavailable({ what, refreshesWithin }: DataUnavailableProps) {
  return (
    <div className="panel px-6 py-8 text-center">
      <div className="microlabel text-warn">TEMPORARILY UNAVAILABLE</div>
      <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-ink-dim">
        {what} could not be read just now. Nothing here is estimated in its place — this page
        refreshes itself within {refreshesWithin}, and the figures return with it.
      </p>
    </div>
  );
}
