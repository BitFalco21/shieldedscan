"use client";

import type { Ref } from "react";
import { AgentComposer } from "@/features/agent/AgentComposer";
import type { useZenoConversation } from "@/features/agent/use-zeno-conversation";
import { ZenoDisclosures } from "@/features/agent/ZenoDisclosures";
import { ZenoLive } from "@/features/agent/ZenoLive";
import { ZenoTranscript } from "@/features/agent/ZenoTranscript";

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
    beginEdit,
    cancelEdit,
    clearConversation,
  } = conversation;
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

      <ZenoTranscript
        conversation={conversation}
        className="px-4 py-4"
        empty={
          <p className="text-sm leading-relaxed text-ink-dim">
            Ask about anything on this page: what shielding does, why exchanges want a t1 address,
            what a viewing key can see.
          </p>
        }
      />

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
