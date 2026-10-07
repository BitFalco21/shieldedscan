"use client";

import { useEffect, useRef } from "react";
import type { Ref } from "react";
import { AgentComposer } from "@/features/agent/AgentComposer";
import { AgentExchange } from "@/features/agent/AgentExchange";
import type { useZenoConversation } from "@/features/agent/use-zeno-conversation";
import { ZenoDisclosures } from "@/features/agent/ZenoDisclosures";
import { ZenoLive } from "@/features/agent/ZenoLive";

/** Room left above a settled turn's question, so it does not sit flush against the header. */
const LAST_TURN_MARGIN_PX = 12;

export interface ZenoDrawerProps {
  /** Focused when a page button asks a question, so a keyboard reader lands where the answer is. */
  ref?: Ref<HTMLElement>;
  open: boolean;
  onClose: () => void;
  conversation: ReturnType<typeof useZenoConversation>;
}

/**
 * Zeno beside the learning page: the same conversation loop, composer, answer rendering and
 * disclosures as `/ai-agent`, in a panel at the side (a sheet from the bottom on a phone).
 *
 * Kept mounted while closed, so a reader who closes it mid-answer finds the answer when they
 * come back, and so its conversation survives the reader switching between practice and the
 * real steps. Nothing is stored: it is the console's state, and it dies with the tab.
 */
export function ZenoDrawer({ ref, open, onClose, conversation }: ZenoDrawerProps) {
  const {
    draft,
    setDraft,
    exchanges,
    busy,
    heldForEdit,
    inputRef,
    zenoTurn,
    send,
    stop,
    askAgain,
    beginEdit,
    cancelEdit,
    clearConversation,
  } = conversation;
  const paneRef = useRef<HTMLDivElement>(null);
  const lastIndex = exchanges.length - 1;

  // While a turn runs, follow its steps down the pane, as the console does. Once it settles, start
  // the reader at the turn's question: the answer is drawn whole at the end, and in a pane this
  // narrow it is nearly always taller than the pane — following it to its foot would open the
  // answer on its sources, with the beginning scrolled out of sight above.
  useEffect(() => {
    const pane = paneRef.current;
    if (pane === null || exchanges.length === 0) return;
    if (busy) {
      pane.scrollTop = pane.scrollHeight;
      return;
    }
    const turns = pane.querySelectorAll(":scope > div > article");
    const last = turns[turns.length - 1];
    if (last === undefined) return;
    const offset = last.getBoundingClientRect().top - pane.getBoundingClientRect().top;
    pane.scrollTop += offset - LAST_TURN_MARGIN_PX;
  }, [exchanges, busy]);

  return (
    <aside
      ref={ref}
      tabIndex={-1}
      role="dialog"
      aria-modal="false"
      aria-label="Ask Zeno"
      hidden={!open}
      onKeyDown={(event) => {
        // The composer uses Escape to cancel an edit and marks it handled; only an unhandled one closes.
        if (event.key === "Escape" && !event.defaultPrevented) onClose();
      }}
      className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-xl border-t border-edge bg-bg shadow-2xl outline-none md:inset-y-0 md:right-0 md:left-auto md:max-h-none md:w-[26rem] md:rounded-none md:border-t-0 md:border-l"
    >
      <header className="flex flex-none items-center gap-3 border-b border-edge-faint px-4 py-2.5">
        <ZenoLive turn={zenoTurn} variant="head" className="w-9" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-green">zeno</p>
          <p className="truncate text-xs text-ink-faint">answers from this explorer’s own data</p>
        </div>
        {exchanges.length > 0 && !busy ? (
          <button
            type="button"
            onClick={clearConversation}
            className="cursor-pointer text-xs text-ink-faint hover:text-green"
            title="Discard this conversation — it is not stored anywhere, so this cannot be undone"
          >
            clear
          </button>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close Zeno"
          className="btn btn-secondary px-2 py-0.5 text-sm"
        >
          ✕
        </button>
      </header>

      <div ref={paneRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {exchanges.length === 0 ? (
          <p className="text-sm leading-relaxed text-ink-dim">
            Ask about anything on this page: what shielding does, why exchanges want a t1 address,
            what a viewing key can see.
          </p>
        ) : (
          <div aria-live="polite" className="space-y-6">
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
        )}
      </div>

      <div className="flex-none border-t border-edge-faint pt-3 lg:px-4 lg:pb-3">
        <AgentComposer
          draft={draft}
          onDraftChange={setDraft}
          busy={busy}
          editPending={heldForEdit !== null}
          canRecall={exchanges.length > 0}
          conversing={exchanges.length > 0}
          placeholder="ask about Zcash or this page"
          inputRef={inputRef}
          onSend={() => void send()}
          onStop={stop}
          onRecall={beginEdit}
          onCancelEdit={cancelEdit}
        />
        <div className="px-4 pb-2 lg:px-0 lg:pb-0">
          <ZenoDisclosures />
        </div>
      </div>
    </aside>
  );
}
