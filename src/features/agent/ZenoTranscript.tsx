"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { AgentExchange } from "./AgentExchange";
import type { useZenoConversation } from "./use-zeno-conversation";

/** Room left above a settled turn's question, so it does not sit flush against the header. */
const LAST_TURN_MARGIN_PX = 12;

export interface ZenoTranscriptProps {
  conversation: ReturnType<typeof useZenoConversation>;
  /** Shown before the first question. */
  empty: ReactNode;
  /**
   * Offer `clear` at the top of the transcript, as the console does — for a panel whose header
   * has no room for it. Hidden while a turn runs, which would abandon an answer being paid for.
   */
  onClear?: () => void;
  /** Below the conversation, in the same scroll: the disclosures, in a panel too short to pin them. */
  footer?: ReactNode;
  className?: string;
}

/**
 * The scrolling conversation of a narrow Zeno panel — the `/learn` drawer and the bubble — drawn
 * with the console's own `AgentExchange`, so answers, sources, the trail and anything an answer
 * learns to carry later render the same in all three places.
 *
 * While a turn runs, it follows the steps down the pane, as the console does. Once the turn
 * settles it starts the reader at the turn's question: the answer is drawn whole at the end, and
 * in a pane this narrow it is nearly always taller than the pane, so following it to its foot
 * would open the answer on its sources with the beginning scrolled out of sight above.
 */
export function ZenoTranscript({
  conversation,
  empty,
  onClear,
  footer,
  className,
}: ZenoTranscriptProps) {
  const { exchanges, busy, heldForEdit, beginEdit, askAgain } = conversation;
  const paneRef = useRef<HTMLDivElement>(null);
  const lastIndex = exchanges.length - 1;

  useEffect(() => {
    const pane = paneRef.current;
    if (pane === null || exchanges.length === 0) return;
    if (busy) {
      pane.scrollTop = pane.scrollHeight;
      return;
    }
    const turns = pane.querySelectorAll("[data-turns] > article");
    const last = turns[turns.length - 1];
    if (last === undefined) return;
    const offset = last.getBoundingClientRect().top - pane.getBoundingClientRect().top;
    pane.scrollTop += offset - LAST_TURN_MARGIN_PX;
  }, [exchanges, busy]);

  return (
    <div ref={paneRef} className={["min-h-0 flex-1 overflow-y-auto", className ?? ""].join(" ")}>
      {exchanges.length === 0 ? (
        empty
      ) : (
        <>
          {onClear !== undefined && !busy && (
            <div className="mb-2 flex justify-end">
              <button
                type="button"
                onClick={onClear}
                className="cursor-pointer text-xs text-ink-faint hover:text-green"
                title="Discard this conversation — it is not stored anywhere, so this cannot be undone"
              >
                <span aria-hidden className="text-green/50">
                  &gt;{" "}
                </span>
                clear
              </button>
            </div>
          )}
          <div data-turns aria-live="polite" className="space-y-6">
            {exchanges.map((exchange, i) => (
              <AgentExchange
                key={exchange.id}
                exchange={exchange}
                live={busy && i === lastIndex}
                editable={i === lastIndex && heldForEdit === null}
                busy={busy}
                retryable={!busy && i === lastIndex && heldForEdit === null && exchange.retryable}
                separated={i > 0}
                onEdit={beginEdit}
                onAskAgain={askAgain}
              />
            ))}
          </div>
        </>
      )}
      {footer}
    </div>
  );
}
