import { RetryButton } from "@/components/RetryButton";

export interface DataUnavailableProps {
  /** What could not be read, in the reader's terms — "the monthly series", not "getMonthlySeries". */
  what: string;
  /**
   * `true` inside a panel, where a second panel would be a box in a box: the same content in a
   * dashed well instead, as `EmptyState` does.
   */
  inset?: boolean;
  /** Layout only — a margin. */
  className?: string;
}

/**
 * A section we could not read, said in words, with a way to ask again.
 *
 * The page-level sibling of `Unmeasured`: an empty series would draw a chart showing Zcash as
 * having no history, and an empty table reads as nothing on the chain. A blank is a claim; "we
 * could not read this right now" is a fact. The Veil is not used here — redaction bars mean
 * "encrypted on-chain, hidden by design", not an outage of ours.
 *
 * The edge may share a page showing this for its fresh window (`lib/edge-cache.ts`); it states no
 * figure, and the next good render replaces it.
 */
export function DataUnavailable({ what, inset = false, className = "" }: DataUnavailableProps) {
  const frame = inset ? "rounded-md border border-dashed border-edge" : "panel";
  return (
    <div
      role="status"
      className={`${frame} flex flex-col items-center gap-3 px-5 py-6 text-center ${className}`.trim()}
    >
      <div className="microlabel text-warn">TEMPORARILY UNAVAILABLE</div>
      <p className="max-w-md text-sm leading-relaxed text-ink-dim">
        {what} could not be read just now. Nothing here is estimated in its place.
      </p>
      <RetryButton />
    </div>
  );
}
