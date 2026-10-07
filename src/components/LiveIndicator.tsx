import type { LiveFeedStatus } from "@/lib/use-live-feed";

/**
 * Whether the list beneath this is still tracking the chain.
 *
 * A live-looking indicator over a frozen list is the worst outcome here: a page that answers
 * 200 and has silently stopped updating. Every stopped state names itself and says what to
 * do, and the three reasons stay distinct because a reader acts on them differently: our own
 * bound, the chain reorganising underneath us, and our own outage.
 *
 * The meaning is in the words, never in the dot: `prefers-reduced-motion` disables every
 * animation, so a pulse that stops would be invisible to the readers who most need the state.
 *
 * Never the Veil: redaction bars mean "encrypted on-chain, hidden by design", not an outage of
 * ours. This is the `Unmeasured`/`DataUnavailable` register instead.
 */

export interface LiveIndicatorProps {
  /** `capped` comes from the list itself, the rest from the feed. */
  status: LiveFeedStatus | "capped";
}

const LABEL: Record<Exclude<LiveFeedStatus, "live"> | "capped", string> = {
  capped: "paused — reload for the newest",
  reorganised: "chain reorganised — reload",
  unavailable: "live updates unavailable",
};

export function LiveIndicator({ status }: LiveIndicatorProps) {
  // Silent while it is working: rows arriving are the signal that the page is live. Every
  // state below is one a reader needs told.
  if (status === "live") return null;
  return (
    <span
      role="status"
      // Polite, not assertive: the state changes rarely, and interrupting a reader mid-sentence
      // to announce it would be worse than the wait.
      aria-live="polite"
      className="microlabel inline-flex items-center gap-1.5 text-ink-faint"
    >
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-ink-faint" />
      {LABEL[status]}
    </span>
  );
}
