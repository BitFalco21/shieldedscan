"use client";

import { useEffect, useRef, useState } from "react";
import { agentAskUrl } from "@/lib/agent";
import { apiBaseUrl } from "@/lib/site";
import { askAgent, endOfStream, historyFor } from "./agent-client";
import type { AgentPage } from "./agent-client";
import { COMPUTING, THINKING_AGAIN, THINKING_FIRST, WORKING } from "./trail-steps";
import { closeLastStep, newExchange, openStep, zenoTurnOf, type Exchange } from "./exchange";

/**
 * One conversation with Zeno: the transcript, the turn in flight, and every way a turn can end.
 *
 * Shared by `/ai-agent` and the learning page's drawer so both run the same loop — the four
 * endings decided in one place (`endOfStream`), the edit hold, stop and ask again — rather than
 * two copies of the one surface that talks to a model. The component around it owns only layout.
 *
 * `page` names the page the conversation lives on, sent with every question so Zeno answers as a
 * guide to it; the console names none.
 */
export function useZenoConversation(page?: AgentPage) {
  const [draft, setDraft] = useState("");
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [busy, setBusy] = useState(false);
  /**
   * The turn `edit` lifted out of the transcript, held until the edit is sent or abandoned.
   *
   * `edit` removes the turn it edits, because a superseded exchange left on screen would be
   * replayed to the model as history. But the removal must not be irreversible, since this page
   * stores nothing: it is a hold. The turn is out of `exchanges` (what `send` builds history
   * from); `cancel` puts it back, and sending drops it for good.
   */
  const [heldForEdit, setHeldForEdit] = useState<Exchange | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  /**
   * Whether the abort in flight is the visitor's own `stop`, rather than a dropped stream. A ref
   * because `send`'s `finally` reads it in the same tick it is written, and it must never
   * re-render: telling the reader "the answer was cut off" when they pressed stop themselves
   * would blame us for their choice.
   */
  const stoppedByUser = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  /** The next exchange's id; ids only need to be unique within this conversation. */
  const nextId = useRef(0);

  // A stream outliving the component would keep burning the day's budget for nobody.
  useEffect(() => () => inFlight.current?.abort(), []);

  /**
   * Put the cursor back in the box once an answer finishes, so a follow-up needs no click.
   *
   * An effect keyed on `busy` rather than a `focus()` at the end of `send()`: the textarea is
   * `disabled` while streaming — which makes the browser blur it — and at the moment `send()`
   * finishes React has not yet re-rendered it as enabled, so focusing there targets a disabled
   * element and silently does nothing. Guarded on there being a conversation, because focusing on
   * first paint would scroll a visitor past the notice they are supposed to read before typing.
   */
  useEffect(() => {
    if (!busy && exchanges.length > 0) inputRef.current?.focus();
  }, [busy, exchanges.length]);

  /**
   * Ask a question. With `replaceLast` the new turn takes the place of the last one — that is
   * `ask again`: the failed turn is not replayed as history, and the transcript does not show two
   * attempts at one question.
   */
  async function send(override?: string, { replaceLast = false } = {}) {
    const question = (override ?? draft).trim();
    if (question === "" || busy) return;

    // History is user/assistant text only: tool results are never replayed, so a follow-up makes
    // the agent re-fetch rather than recall something stale. Which exchanges survive is
    // `historyFor`'s rule, extracted so it can be tested without a stream.
    const kept = replaceLast ? exchanges.slice(0, -1) : exchanges;
    const history = historyFor(kept, question);

    if (override === undefined) setDraft("");
    setBusy(true);
    // The replaced turn is gone for good the moment its replacement is sent. Holding it any
    // longer would let a later `cancel` resurrect a question the visitor has already superseded.
    setHeldForEdit(null);
    stoppedByUser.current = false;
    const turn = newExchange(nextId.current++, question, Date.now());
    setExchanges((prev) => [...(replaceLast ? prev.slice(0, -1) : prev), turn]);

    const controller = new AbortController();
    inFlight.current = controller;
    /** Rewrite the exchange being streamed. `answer` may only ever be appended to. */
    const patchLive = (change: (e: Exchange) => Partial<Exchange>) =>
      setExchanges((prev) =>
        prev.map((e, i) => (i === prev.length - 1 ? { ...e, ...change(e) } : e)),
      );
    const patch = (change: Partial<Exchange>) => patchLive(() => change);

    /**
     * The endpoint's own words for a transport failure, held rather than rendered: a stream can
     * end in four ways (`done`, an `error` event, the visitor's stop, or the body simply
     * stopping) and the note has to be decided from the same facts in all four, or one of them
     * gets the wrong sentence. So every path lands in the `finally` below, once.
     */
    let upstreamMessage: string | null = null;
    // Whether this turn has looked anything up yet: the whole difference between "reading the
    // question" and "reading what came back". A closure variable, reset by construction because
    // `send` runs once per turn.
    let lookedUp = false;

    try {
      for await (const event of askAgent(
        agentAskUrl(apiBaseUrl),
        history,
        controller.signal,
        page,
      )) {
        switch (event.event) {
          case "status": {
            // One vocabulary for the trail's header and its rows: the words are built here once
            // and stored, so a step cannot be described one way while it runs and another way
            // afterwards. The calculator reads nothing, so "looking up" would misdescribe it.
            const words =
              event.state === "looking-up"
                ? event.tool === "calculate"
                  ? COMPUTING
                  : `looking up ${describeTool(event.tool)}`
                : lookedUp
                  ? THINKING_AGAIN
                  : THINKING_FIRST;
            const at = Date.now();
            patchLive((e) => ({
              steps: openStep(e.steps, {
                kind: event.state === "looking-up" ? "lookup" : "thinking",
                label: words,
                ...(event.tool !== undefined ? { tool: event.tool } : {}),
                ...(event.detail !== undefined ? { detail: event.detail } : {}),
                startedAt: at,
                endedAt: null,
              }),
            }));
            // after the phrase is built, so the round that opens a lookup is not itself described
            // as reading the result it has not fetched yet.
            if (event.state === "looking-up") lookedUp = true;
            break;
          }
          case "narration": {
            /*
             * The model's working before a tool call, routed into the trail as a step and nowhere
             * else — never `live` or `answer`, which feed the answer body, the replayed history
             * and the copy button. It arrives sanitised (`narrationText`, server-side) and
             * finished, right before the `looking-up` status it preceded. `openStep` rather than a
             * bare push, so the wait in flight is closed at the same instant.
             */
            const at = Date.now();
            patchLive((e) => ({
              // The live line's working is now this row; a round the gate silenced sends no
              // `reset`, so this is the boundary that clears it.
              working: "",
              steps: openStep(e.steps, {
                kind: "narration",
                label: event.text,
                startedAt: at,
                endedAt: at,
              }),
            }));
            break;
          }
          case "working":
          case "delta":
            patchLive((e) => ({
              ...(event.event === "working"
                ? { working: e.working + event.text }
                : { live: e.live + event.text }),
              // The loop emits no status between a tool's result and the prose that follows it,
              // so the answering step is opened by the prose itself — only by the first token of
              // the round, or `openStep` would start a new step per token.
              steps:
                e.steps[e.steps.length - 1]?.kind === "answering"
                  ? e.steps
                  : openStep(e.steps, {
                      kind: "answering",
                      label: WORKING,
                      startedAt: Date.now(),
                      endedAt: null,
                    }),
            }));
            break;
          case "reset":
            /*
             * The text so far was the model narrating its way to a tool call, not answering, so
             * it is discarded; a sanitised copy arrives next as `narration` and lands in the
             * trail. The answering step goes with it: a round that ends in a tool call was never
             * answering. Every answering step present now is preamble by definition — the real
             * one is always last — so this is a filter, which holds in whichever order events
             * arrive.
             */
            patchLive((e) => ({
              live: "",
              working: "",
              steps: e.steps.filter((s) => s.kind !== "answering"),
            }));
            break;
          case "sources":
            patch({ sources: event.sources });
            break;
          case "done":
            patch({
              status: event.stopReason === "complete" ? "complete" : "truncated",
              note:
                event.stopReason === "length"
                  ? "The answer hit its length limit."
                  : event.stopReason === "tool-limit"
                    ? "The agent ran out of lookups for this question."
                    : null,
              // The server's own closing, not an answer: no celebration, and `ask again` is the
              // remedy the closing itself names.
              unanswered: event.unanswered === true,
              retryable: event.unanswered === true,
            });
            break;
          case "error":
            upstreamMessage = event.message;
            break;
        }
      }
    } finally {
      inFlight.current = null;
      const stopped = stoppedByUser.current;
      // Commit whatever the last round wrote. Here rather than in the `done` case because a
      // stream can end without one (an error, a dropped connection), and text the visitor can
      // read must be the text a follow-up replays as history. An APPEND, per `Exchange.answer`.
      patchLive((e) => {
        const answer = e.answer + e.live;
        // `done` already said how the turn ended and its note is the accurate one. Only an
        // unsettled exchange needs a verdict here, and `endOfStream` is the single place that
        // decides it.
        const settled = e.status === "complete" || e.status === "truncated";
        return {
          answer,
          live: "",
          working: "",
          // A step left open would render its cursor for the rest of the visit.
          steps: closeLastStep(e.steps, Date.now()),
          ...(settled
            ? {}
            : {
                ...endOfStream(
                  answer,
                  stopped ? "stopped" : upstreamMessage !== null ? "error" : "ended",
                  upstreamMessage,
                ),
                stopped,
                // A failure or a cut-off is worth retrying; the visitor's own stop is not.
                retryable: !stopped,
              }),
        };
      });
      setBusy(false);
      // Focus is not restored here — see the effect above.
    }
  }

  /**
   * Abandon the answer in flight. A reader watching a wrong answer assemble itself should not
   * have to wait for it, and it stops burning the day's token budget on an answer nobody wants.
   */
  function stop() {
    stoppedByUser.current = true;
    inFlight.current?.abort();
  }

  /** Send the last question again in place of its failed turn. */
  function askAgain() {
    const last = exchanges[exchanges.length - 1];
    if (last === undefined || busy || heldForEdit !== null) return;
    void send(last.question, { replaceLast: true });
  }

  /**
   * Put the last question back in the composer to be changed, and hold the turn it produced.
   *
   * **Replacement, not recall.** Leaving the superseded exchange on screen would send the model
   * the very question being replaced as history. Only the last turn is editable: editing an
   * earlier one would invalidate every answer after it.
   */
  function beginEdit() {
    // `heldForEdit` guards a second edit: while one is pending the last visible turn is an
    // earlier one, and lifting that too would strand the first with nowhere to go back to.
    if (busy || heldForEdit !== null) return;
    const last = exchanges[exchanges.length - 1];
    if (last === undefined) return;
    setExchanges((prev) => prev.slice(0, -1));
    setHeldForEdit(last);
    setDraft(last.question);
    const input = inputRef.current;
    if (input === null) return;
    input.focus();
    // After React writes the value, put the caret at the end — a caret at position 0 turns the
    // next keystroke into a prefix, which is not what "edit this" means.
    requestAnimationFrame(() => input.setSelectionRange(input.value.length, input.value.length));
  }

  /**
   * Abandon a pending edit and put the turn back exactly as it was. The draft goes with it:
   * "cancel" means the turn survives unchanged.
   */
  function cancelEdit() {
    const held = heldForEdit;
    if (held === null) return;
    setExchanges((prev) => [...prev, held]);
    setHeldForEdit(null);
    setDraft("");
    inputRef.current?.focus();
  }

  /**
   * Discard the whole conversation. Everything this page holds is in this state, so this IS the
   * delete — no history, no localStorage and no server-side transcript to clean up afterwards.
   * The held edit goes with it: a turn `cancel` could resurrect would make "clear" a lie.
   */
  function clearConversation() {
    setExchanges([]);
    setHeldForEdit(null);
    setDraft("");
    inputRef.current?.focus();
  }

  const lastIndex = exchanges.length - 1;
  // While an edit holds the last turn, Zeno waits with the reader rather than replaying how the
  // turn before it ended.
  const zenoTurn = heldForEdit !== null ? null : zenoTurnOf(exchanges[lastIndex], busy);

  return {
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
  };
}

/**
 * Plain words for a tool name, so the trail reads as English. The trail's rows are the whole of
 * what a reader sees of a lookup, so every tool the API offers has its own entry: "the chain"
 * would misdescribe a third-party or price-store read as a node read, and is only the fallback
 * for a tool this build does not know yet.
 */
function describeTool(tool: string | undefined): string {
  switch (tool) {
    case "lookup_transaction":
      return "the transaction";
    case "lookup_block":
      return "the block";
    case "lookup_address":
      return "the address";
    case "chain_status":
      return "the chain's current state";
    case "explorer_analytics":
      return "the aggregate series";
    case "explorer_insights":
      return "this explorer's own analytics";
    case "zec_price_history":
      return "the daily price history";
    case "wrapped_zec_pools":
      return "wrapped-ZEC pools on other chains";
    case "zip_index":
      return "the ZIP index";
    case "crosschain":
      return "ZEC crossing to and from other chains";
    case "chain_activity":
      return "activity totals for that period";
    case "zcash_reference":
      // Deliberately not "the chain": nothing is read from the node for this one, and a status
      // line claiming a chain lookup for a committed constant misdescribes where the answer
      // about to appear came from.
      return "Zcash's documented history";
    case "site_guide":
      return "this explorer's own pages and API";
    case "calculate":
      // Defensive: `send` labels a calculation `COMPUTING` before asking here. The phrase still
      // has to survive a "looking up" prefix without claiming a read that never happened.
      return "a calculation";
    default:
      return "the chain";
  }
}
