"use client";

import { useCallback, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Zeno } from "@/features/agent/Zeno";
import { useZenoConversation } from "@/features/agent/use-zeno-conversation";
import { AskZenoContext, CoachPresenceContext } from "./zeno-context";
import { ZenoDrawer } from "./ZenoDrawer";

export interface LearnZenoProps {
  /** The deployment's agent flag, decided at build time. Off: no launcher, no drawer, no buttons. */
  enabled: boolean;
  children: ReactNode;
}

/**
 * Zeno on the learning page: one conversation for the whole page, a launcher in the corner, and
 * the `ask` that every "ask zeno" button calls.
 *
 * A button's question is asked at once, exactly as the console's own example questions are: the
 * text is this page's — a fixed, general question — so nothing of the reader's leaves with it. No
 * button ever carries an address or a transaction ID the reader pasted: a question goes to a
 * third-party model, and sending something of theirs is a choice only the reader makes, by typing
 * it into the composer under the warning.
 */
export function LearnZeno({ enabled, children }: LearnZenoProps) {
  if (!enabled) return <>{children}</>;
  return <EnabledLearnZeno>{children}</EnabledLearnZeno>;
}

function EnabledLearnZeno({ children }: { children: ReactNode }) {
  // Every question from here, typed or pressed, tells Zeno it came from the learning page, so he
  // answers a newcomer, short and plain, and points at the page's next step (see
  // `server/agent/page-context.ts`).
  const conversation = useZenoConversation("learn");
  const [open, setOpen] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  const { inputRef, busy, heldForEdit, send } = conversation;

  const focusComposer = useCallback(() => {
    // After React has un-hidden the drawer; focusing a hidden element does nothing.
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (input === null) return;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
  }, [inputRef]);

  const openDrawer = () => setOpen(true);
  /** Zeno is on screen as the tour's guide: no second Zeno in the corner meanwhile. */
  const [coaching, setCoaching] = useState(false);

  const ask = (question: string) => {
    openDrawer();
    // Mid-answer, or holding a turn for an edit: the reader is in the middle of something, so the
    // drawer opens on it and nothing is sent or overwritten.
    if (busy || heldForEdit !== null) return;
    void send(question);
    // Into the drawer, where the answer is: the composer is disabled while it streams, and takes
    // focus back when the answer is done.
    requestAnimationFrame(() => drawerRef.current?.focus());
  };

  return (
    <AskZenoContext.Provider value={ask}>
      <CoachPresenceContext.Provider value={setCoaching}>{children}</CoachPresenceContext.Provider>
      {open || coaching ? null : (
        <button
          type="button"
          onClick={() => {
            openDrawer();
            focusComposer();
          }}
          className="panel fixed right-4 bottom-[calc(env(safe-area-inset-bottom,0px)+1rem)] z-40 flex cursor-pointer items-center gap-2 rounded-full p-1.5 text-sm text-green hover:text-ink-bright sm:py-1.5 sm:pr-4 sm:pl-2"
        >
          <Zeno variant="head" className="w-8" />
          {/* On a phone just the face: a labelled pill there covered the controls beneath it. */}
          <span className="sr-only sm:not-sr-only">ask zeno</span>
        </button>
      )}
      <ZenoDrawer
        ref={drawerRef}
        open={open}
        onClose={() => setOpen(false)}
        conversation={conversation}
      />
    </AskZenoContext.Provider>
  );
}
