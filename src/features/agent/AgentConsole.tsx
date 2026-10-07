"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { AgentComposer } from "./AgentComposer";
import { AgentEmptyState } from "./AgentEmptyState";
import { AgentExchange } from "./AgentExchange";
import { useZenoConversation } from "./use-zeno-conversation";
import { ZenoLive } from "./ZenoLive";
import { ZenoRail } from "./ZenoRail";

/**
 * Zeno's console: the rail, the conversation and the composer — the whole of `/ai-agent`. The
 * frame fills the window below the site's nav so the page reads as an application; the site
 * footer is one scroll below.
 *
 * Stores nothing — no localStorage, no cookie, no history beyond this component's state, which
 * dies with the tab. `/privacy` makes that claim on this feature's behalf, so it must be true
 * here. It is also why there is no "share this question" (a share link would have to carry or
 * store the conversation) and no suggested follow-ups.
 *
 * The transcript is an `aria-live="polite"` region so a screen reader hears the answer arrive
 * without the stream interrupting itself on every token.
 */

export interface AgentConsoleProps {
  /** The disclosures, rendered once inside the rail (below the conversation on a phone). */
  about?: ReactNode;
}

export function AgentConsole({ about }: AgentConsoleProps) {
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
  } = useZenoConversation();
  const paneRef = useRef<HTMLDivElement>(null);

  // Follow the stream, or a long answer writes itself out of sight. `auto` rather than `smooth`:
  // this fires on nearly every event, and an animated scroll per event fights itself. Never on
  // the empty state, which is taller than a phone's pane and starts with Zeno — scrolling it to
  // its foot would hide him.
  useEffect(() => {
    const pane = paneRef.current;
    if (pane !== null && exchanges.length > 0) pane.scrollTop = pane.scrollHeight;
  }, [exchanges, busy]);

  const lastIndex = exchanges.length - 1;

  return (
    /*
      The frame fills the window below the nav. On a wide screen it is the rail and the console
      side by side, 20px clear of the nav and of the window's foot (nav 63px + 20 + 1 = 5.25rem);
      on a phone it bleeds to the screen edges (`-mx-6` cancels the page gutter) and stacks: the
      rail's bar, the console — sized to end at the window's foot, 111px being the nav (63px)
      plus the bar (48px), measured — then the rail's disclosures below the fold.
    */
    <div className="-mx-6 flex flex-col lg:mx-0 lg:h-[calc(100dvh-5.25rem)] lg:min-h-[34rem] lg:flex-row lg:gap-5 lg:pt-5">
      <ZenoRail turn={zenoTurn}>{about}</ZenoRail>

      <section
        aria-label="Conversation with Zeno"
        className="flex h-[calc(100dvh-111px)] min-h-[26rem] min-w-0 flex-col lg:h-auto lg:min-h-0 lg:flex-1 lg:gap-2.5"
      >
        {/* The session pane is one fixed height in every state, and its content is
            top-aligned. A pane sized by its content would shrink when a question was sent and
            grow back as the answer arrived; bottom-aligning inside a fixed pane would move
            the empty state's text the full height of the pane on the first send. Content
            grows downward and the pane scrolls internally, as every chat does.

            The edge is the faint one while the composer keeps `--edge`: this is the surface
            you read, that is the one you type into. On a phone the pane drops its frame and
            the console is the screen. */}
        <div
          ref={paneRef}
          className="panel flex min-h-0 flex-1 flex-col overflow-y-auto border-edge-faint px-4 py-[18px] max-lg:rounded-none max-lg:border-0 max-lg:bg-transparent max-lg:shadow-none lg:px-[26px] lg:py-[22px]"
        >
          {exchanges.length === 0 ? (
            <AgentEmptyState onPick={(question) => void send(question)} disabled={busy} />
          ) : (
            <div aria-live="polite" className="space-y-6">
              {/* `clear` — the word, not an icon, at the top of the transcript and far from
                  `send`: the two are adjacent in intent and opposite in consequence. No
                  confirmation: a destructive step may be taken on intent, never on
                  inspection, and clicking `clear` is intent. Hidden while a turn runs, which
                  would abandon an answer already being paid for. */}
              {!busy && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={clearConversation}
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
              {exchanges.map((exchange, i) => (
                <AgentExchange
                  key={exchange.id}
                  exchange={exchange}
                  live={busy && i === lastIndex}
                  // Absent, not disabled, while an edit is pending: the turn showing it would
                  // then be an earlier one, and `beginEdit` refuses that.
                  editable={i === lastIndex && heldForEdit === null}
                  busy={busy}
                  retryable={!busy && i === lastIndex && heldForEdit === null && exchange.retryable}
                  separated={i > 0}
                  onEdit={beginEdit}
                  onAskAgain={askAgain}
                  stage={
                    // A phone has no rail figure to watch, so the working Zeno comes into the
                    // turn itself while it runs. Decorative: the trail above says it in words.
                    i === lastIndex ? (
                      <div
                        aria-hidden
                        className="zeno-wash flex justify-center overflow-hidden rounded-md border border-edge-faint py-1.5 lg:hidden"
                      >
                        <ZenoLive turn={zenoTurn} stage className="w-[220px]" />
                      </div>
                    ) : undefined
                  }
                />
              ))}
            </div>
          )}
        </div>

        <AgentComposer
          draft={draft}
          onDraftChange={setDraft}
          busy={busy}
          editPending={heldForEdit !== null}
          canRecall={exchanges.length > 0}
          conversing={exchanges.length > 0}
          inputRef={inputRef}
          onSend={() => void send()}
          onStop={stop}
          onRecall={beginEdit}
          onCancelEdit={cancelEdit}
        />
      </section>
    </div>
  );
}
