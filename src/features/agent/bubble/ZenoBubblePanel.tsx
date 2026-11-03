"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, type MouseEvent } from "react";
import { AgentComposer } from "../AgentComposer";
import { useZenoConversation } from "../use-zeno-conversation";
import { ZenoDisclosures } from "../ZenoDisclosures";
import { ZenoTranscript } from "../ZenoTranscript";
import { bubbleSuggestions, describeBubblePage, type BubbleSuggestion } from "./bubble-pages";
import { handOff } from "./handoff";
import { useSheetModal } from "./use-sheet-modal";
import { ZenoBubbleChip } from "./ZenoBubbleChip";
import { ZenoBubbleEmpty } from "./ZenoBubbleEmpty";
import { ZenoBubbleHeader } from "./ZenoBubbleHeader";
import { ZenoSheetHandle } from "./ZenoSheetHandle";

export interface ZenoBubblePanelProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Zeno in a panel over any page: docked at the bottom right beside the page on a wide screen, a
 * bottom sheet on a phone. Loaded on the first press of the bubble, never with the page.
 *
 * The console's loop, composer, answers and disclosures, reused rather than copied. Kept mounted
 * while closed, so an answer keeps arriving behind a closed panel and is there when it reopens;
 * it lives in the root layout, so it also survives moving between pages. Stores nothing: the
 * conversation is this component's state and dies with the tab, or when the reader goes to a page
 * without the bubble (`bubble-routes.ts`).
 *
 * The composer's own box grows to six lines here rather than the console's ten: the panel is
 * 620px tall, and a taller box would leave no conversation to read.
 */
export function ZenoBubblePanel({ open, onClose }: ZenoBubblePanelProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const conversation = useZenoConversation(undefined, { refocusWithin: dialogRef });
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
  const page = describeBubblePage(usePathname() ?? "/");
  const modal = useSheetModal(dialogRef, open);

  /** Focus the box with the caret after its text, once React has written the text. */
  const focusComposer = useCallback(
    () =>
      requestAnimationFrame(() => {
        const input = inputRef.current;
        if (input === null || input.disabled) return;
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }),
    [inputRef],
  );

  // Into the panel on open. An effect, not the bubble's click handler: on the first press this
  // component's code is still loading when the click runs. On a phone the sheet itself takes
  // focus rather than the box, whose keyboard would cover the suggestions the moment it opens.
  useEffect(() => {
    if (!open) return;
    if (modal) dialogRef.current?.focus();
    else focusComposer();
  }, [open, modal, focusComposer]);

  function pick(suggestion: BubbleSuggestion) {
    if (busy || heldForEdit !== null) return;
    if (suggestion.send) {
      void send(suggestion.question);
      return;
    }
    setDraft(suggestion.question);
    focusComposer();
  }

  function continueInConsole(event: MouseEvent<HTMLAnchorElement>) {
    // The bubble unmounts on `/ai-agent`, which would abort the turn in flight.
    if (busy) {
      event.preventDefault();
      return;
    }
    // A new-tab click leaves this page, and this conversation, where they are; a handoff left in
    // the slot would surface on the reader's next ordinary visit to the console.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    // A turn lifted for an edit is still part of the conversation: it goes back in place.
    handOff(heldForEdit === null ? exchanges : [...exchanges, heldForEdit]);
  }

  return (
    // One element around the scrim and the dialog, so the phone's modal mode leaves both usable
    // while it silences the rest of the page (`useSheetModal`).
    <div hidden={!open}>
      {/* The page dims behind the phone sheet, and a tap there closes it. Beside a desktop page
          there is no scrim: the page stays in use. */}
      <div aria-hidden onClick={onClose} className="scrim fixed inset-0 z-50 sm:hidden" />
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal={modal}
        aria-label="Ask Zeno"
        onKeyDown={(event) => {
          // The composer uses Escape to cancel an edit and marks it handled; only an unhandled one
          // closes.
          if (event.key === "Escape" && !event.defaultPrevented) onClose();
        }}
        // The last two variants reach into the shared composer, answers and disclosures: six
        // lines for the box, and finger-sized controls on a phone, leaving the console as it is.
        className="fixed inset-x-0 bottom-0 z-50 flex h-[88dvh] flex-col rounded-t-xl border-t border-edge-strong bg-bg shadow-2xl sm:inset-x-auto sm:right-6 sm:bottom-6 sm:h-[min(620px,calc(100dvh-3rem))] sm:w-[420px] sm:rounded-lg sm:border [&_.autogrow::after]:max-h-[6lh] max-sm:[&_:is(button,summary)]:min-h-11"
      >
        <ZenoSheetHandle onDragClose={onClose} />
        <ZenoBubbleHeader
          turn={zenoTurn}
          busy={busy}
          onContinue={continueInConsole}
          onClose={onClose}
        />
        <ZenoBubbleChip
          page={page}
          disabled={busy}
          onAdd={(subject) => {
            const words = `${subject.noun} ${subject.id}`;
            setDraft((current) =>
              current.trim() === "" ? words : `${current.trimEnd()} ${words}`,
            );
            focusComposer();
          }}
        />
        <ZenoTranscript
          conversation={conversation}
          className="overscroll-contain px-4 pt-3 pb-2"
          onClear={clearConversation}
          empty={
            <ZenoBubbleEmpty
              suggestions={bubbleSuggestions(page)}
              onPick={pick}
              disabled={busy || heldForEdit !== null}
            />
          }
          // In the scroll rather than pinned under the composer: a 620px panel cannot spare the
          // two rows, and the composer already carries the notices that must stay in sight.
          footer={
            <div className="mt-5">
              <ZenoDisclosures />
            </div>
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
            // Short enough for one row of a 420px panel; the console's own are cut off here.
            placeholder={
              exchanges.length > 0 ? "ask a follow-up…" : "ask about blocks, pools, prices…"
            }
            inputRef={inputRef}
            onSend={() => void send()}
            onStop={stop}
            onRecall={beginEdit}
            onCancelEdit={cancelEdit}
          />
        </div>
      </div>
    </div>
  );
}
