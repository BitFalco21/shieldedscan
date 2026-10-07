"use client";

import { useState, type RefObject } from "react";

/**
 * The composer, and the standing notice above it.
 *
 * It must read unmistakably as the place to type, using idioms the design system already owns:
 *  - the prompt-and-cursor: `you>` (answered by `zeno>` above each answer) and a blinking block
 *    where the first character will land — `.cursor-block`, not `.logo-cursor`, whose glow is
 *    reserved for one mark per view;
 *  - a footer strip inside the panel, which gives the control a bottom edge and a visible
 *    extent;
 *  - the send button as the primary action, tinted rather than outlined;
 *  - the CRT corner ticks (`corner-frame`), the one framed control per view.
 */

const MAX_CHARS = 1_500;

export interface AgentComposerProps {
  draft: string;
  onDraftChange: (value: string) => void;
  busy: boolean;
  /** An `edit` is holding the last turn: `cancel` and Escape give it back. */
  editPending: boolean;
  /** There is a turn to lift back with ↑ in an empty box. */
  canRecall: boolean;
  /** A conversation exists, so the placeholder offers a follow-up rather than a first question. */
  conversing: boolean;
  /**
   * Replaces both default placeholders, for a page with its own subject (the learning page's
   * drawer). Keep it short enough for one row on a phone: the field is one row tall until the
   * reader types, so a longer placeholder is cut off mid-word.
   */
  placeholder?: string;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onSend: () => void;
  onStop: () => void;
  onRecall: () => void;
  onCancelEdit: () => void;
}

export function AgentComposer({
  draft,
  onDraftChange,
  busy,
  editPending,
  canRecall,
  conversing,
  placeholder,
  inputRef,
  onSend,
  onStop,
  onRecall,
  onCancelEdit,
}: AgentComposerProps) {
  /** Only to decide whether the composer shows its "type here" cursor. */
  const [focused, setFocused] = useState(false);

  return (
    <div className="flex flex-none flex-col gap-2 px-4 pb-3.5 lg:px-0 lg:pb-0">
      {/* The standing notice stays above the input: the question leaves for a third party,
          and the key warning is useless if read after typing. A dim comment line rather than
          a warning panel (a paragraph-sized amber box is the shape people skip), with the
          shell's `#` inline so it never wraps onto its own line. The vendors are named in the
          "what leaves this site" disclosure. */}
      <p className="text-[11px] leading-normal text-ink-faint lg:text-xs">
        <span aria-hidden className="text-green-dim">
          #{" "}
        </span>
        answers are ai generated and can be wrong ·{" "}
        <span className="text-warn">never paste a viewing key or seed phrase</span>
      </p>

      {/* A size container, so the footer hint follows the composer's own width rather than
          the viewport: the same composer sits in the console's wide column and in the
          learning page's 26rem drawer. */}
      <form
        className="@container"
        onSubmit={(e) => {
          e.preventDefault();
          onSend();
        }}
      >
        {/*
          `rounded-none` because a square tick over the panel's 6px radius misses the curve, and
          utilities beat the layered `.panel` rule, which is what that layering is for. The ends
          span carries the bottom pair of ticks (an element has only two pseudo-elements).
        */}
        <div className="panel prompt-focus corner-frame rounded-none">
          <span aria-hidden className="corner-frame-ends" />
          <div className="flex items-start gap-2 px-3 pt-2.5 pb-2">
            <span aria-hidden className="text-sm leading-relaxed text-green">
              you&gt;
            </span>
            {/*
              Always rendered and only made `invisible`, never unmounted: removing it would shift
              the field 0.6em left on focus, and this control exists to stop things moving.
            */}
            <span
              aria-hidden
              className={`cursor-block shrink-0 self-center ${
                draft === "" && !focused && !busy ? "" : "invisible"
              }`}
            />
            <label htmlFor="agent-question" className="sr-only">
              Ask a question about Zcash or this explorer
            </label>
            {/* `data-value` feeds the CSS mirror that sizes this box (`.autogrow`): it grows from
                one row to ten and then scrolls. */}
            <div data-value={draft} className="autogrow min-w-0 flex-1 text-sm leading-relaxed">
              <textarea
                id="agent-question"
                ref={inputRef}
                rows={1}
                maxLength={MAX_CHARS}
                value={draft}
                disabled={busy}
                onChange={(e) => onDraftChange(e.target.value)}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    onSend();
                    return;
                  }
                  // The shell's own history gesture, and the same action as `edit` rather than a
                  // second one with different semantics. Guarded on an empty box so it never
                  // steals a caret move inside a draft the visitor is still writing.
                  if (
                    e.key === "ArrowUp" &&
                    draft === "" &&
                    !busy &&
                    !e.shiftKey &&
                    !e.metaKey &&
                    !e.ctrlKey &&
                    !e.altKey &&
                    canRecall
                  ) {
                    e.preventDefault();
                    onRecall();
                    return;
                  }
                  // Escape is the conventional "never mind" for a control that has taken over the
                  // box. Inert with no edit pending, so it never clears an ordinary draft.
                  if (e.key === "Escape" && editPending) {
                    e.preventDefault();
                    onCancelEdit();
                  }
                }}
                // The placeholder is the next-step affordance, so it must not still be advertising
                // the question just asked. It names what can be asked before a conversation, and
                // the follow-up once one exists.
                placeholder={
                  placeholder ??
                  (conversing
                    ? "ask a follow-up, or start something new"
                    : "ask about a block, a pool, a swap, a price, a ZIP…")
                }
                className="w-full bg-transparent p-0 text-ink placeholder:text-ink-faint disabled:opacity-60"
              />
            </div>
          </div>

          {/* "nothing you type is saved", not "nothing is saved": the API keeps a per-UTC-day
              count of requests and tokens (`agent_budget`) — a number, never a who — so the
              stronger sentence would be slightly false. "shift+enter" is keyed to the
              composer's width: a phone has no shift key beside return, and in a narrow
              composer the clause wrapped mid-phrase. No "↑ edits your last question" clause:
              the shortcut fires only in an empty box, so `edit`'s own `title` names it
              instead. */}
          <div className="flex items-center gap-x-3 border-t border-edge-faint px-3 py-2">
            <p className="flex min-w-0 flex-wrap gap-x-2 text-xs text-ink-faint">
              <span>
                enter sends<span className="hidden @md:inline"> · shift+enter for a new line</span>
              </span>
              <span aria-hidden className="hidden text-green/40 @md:inline">
                ·
              </span>
              <span>nothing you type is saved</span>
              {MAX_CHARS - draft.length < 300 && (
                <>
                  <span aria-hidden className="text-green/40">
                    ·
                  </span>
                  <span className="text-warn">{MAX_CHARS - draft.length} characters left</span>
                </>
              )}
            </p>
            {/* `cancel` appears only while an edit is pending, so `edit` is never a one-way
                door. Neutral ink, like `stop`: two green buttons side by side would make the
                one that discards a draft look like the thing to press.

                While a stream is open the primary action becomes `stop`, at the same width so
                the footer does not shift — neutral rather than amber or red, because
                abandoning an answer is neither a warning nor an error.

                The brackets (and send's ⏎, which is in the self-hosted font) are aria-hidden
                so a screen reader hears the verb. Focus is a border-and-wash change rather
                than an outline, because `.prompt-focus` suppresses descendants' outlines so
                the panel can carry the ring. */}
            {!busy && editPending && (
              <button
                type="button"
                onClick={onCancelEdit}
                title="Keep the answer and discard this edit (Esc)"
                className="btn btn-secondary ml-auto shrink-0 px-2 py-1 focus-visible:border-green focus-visible:text-ink-bright"
              >
                <span aria-hidden>[ </span>cancel<span aria-hidden> ]</span>
              </button>
            )}
            {busy ? (
              <button
                type="button"
                onClick={onStop}
                className="btn btn-secondary ml-auto w-24 shrink-0 px-2 py-1 focus-visible:border-green focus-visible:text-ink-bright"
              >
                <span aria-hidden>[ </span>stop<span aria-hidden> ]</span>
              </button>
            ) : (
              <button
                type="submit"
                disabled={draft.trim() === ""}
                // `ml-auto` belongs to whichever button is first in the row; with it on both, the
                // two would be pushed apart instead of sitting together.
                className={[
                  editPending ? "" : "ml-auto",
                  "btn btn-primary w-24 shrink-0 px-2 py-1 focus-visible:border-green focus-visible:bg-green-wash-strong focus-visible:text-ink-bright",
                ].join(" ")}
              >
                <span aria-hidden>[ </span>send<span aria-hidden> ⏎ ]</span>
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
