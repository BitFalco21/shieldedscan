"use client";

import { useState } from "react";
import { useTickingNow } from "@/lib/use-ticking-now";
import {
  COMPUTING,
  concreteSteps,
  groupSteps,
  liveHeadline,
  workingExcerpt,
  type AgentStep,
} from "./trail-steps";

/**
 * The thinking trail: what the agent did to reach the answer, as rows a reader can open.
 *
 * Rows are recorded execution facts plus the model's pre-tool-call narration. A narration and
 * the lookup it precedes form one row (sentence first, sanitised arguments and duration
 * beneath). Narration is preamble the model already wrote (reasoning stays off at the provider),
 * sanitised server-side (`narrationText`), rendered as plain text, and kept in `steps` only, so
 * it never reaches the answer, the replayed history or the copy button.
 *
 * The answer body draws nothing until the turn settles, because until a round ends the console
 * cannot tell working from the answer. Meanwhile the trail shows a one-line live excerpt
 * (`workingExcerpt`), and the header follows the loop: "reading the question", "working", the
 * lookup in flight, "reading what came back".
 *
 * Every animation is a CSS class in `globals.css`, never an inline style.
 */

export interface AgentTrailProps {
  steps: readonly AgentStep[];
  /** Whether the turn is still running — drives the header's wording and the auto-open. */
  live: boolean;
  /**
   * The round's candidate-answer prose (the console's `Exchange.live`): the live line shows its
   * first sentence, frozen. Only read while `live`; the settled trail never draws it.
   */
  prose?: string;
  /** Prose the server has flagged as working (`Exchange.working`): the live line rolls with it. */
  working?: string;
}

/** How often the live header's timer redraws: often enough that tenths of a second move. */
const ELAPSED_TICK_MS = 100;

/** One decimal, because the interesting differences here are fractions of a second. */
function seconds(ms: number): string {
  const total = ms / 1000;
  if (total < 60) return `${total.toFixed(1)}s`;
  return `${Math.floor(total / 60)}m ${(total % 60).toFixed(0)}s`;
}

/** The wavefront loader: nine cells, delays in `globals.css` because a chevron is a fixed shape. */
function PixelGrid() {
  return (
    <span aria-hidden className="grid shrink-0 grid-cols-3 gap-[1.5px]">
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className="pixel-cell" />
      ))}
    </span>
  );
}

/**
 * The mark for a finished concrete step: a lens for a read, an equals sign for a calculation.
 *
 * Shape is the channel, not colour (the privacy shields' rule): the two differ by path geometry,
 * so they read identically to someone who cannot separate the hues. Paths rather than glyphs,
 * since JetBrains Mono lacks some characters and an icon font is a request the CSP forbids. No
 * `id`, `clipPath` or gradient: a trail renders many of these, and shared ids are invalid
 * markup.
 */
function StepIcon({ computing }: { computing: boolean }) {
  return (
    <svg
      aria-hidden
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="mt-px shrink-0 text-green/60"
    >
      {computing ? (
        <>
          <path d="M5 9h14" />
          <path d="M5 15h14" />
        </>
      ) : (
        // A lens. The tail points down-left, away from the text that follows it.
        <>
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="M20 20l-4.7-4.7" />
        </>
      )}
    </svg>
  );
}

/**
 * The `·`-joined subject as nowrap atoms — group the atom, never forbid the wrap. The separator
 * carries real spaces, not padding alone: two inline spans with no whitespace between them give
 * the line engine no place to break.
 */
function Subject({ detail }: { detail: string }) {
  return (
    <>
      {detail.split(" · ").map((part, i) => (
        <span key={`${i}-${part}`}>
          {i > 0 && <span className="text-ink-faint/50">{" · "}</span>}
          <span className="whitespace-nowrap text-ink-faint">{part}</span>
        </span>
      ))}
    </>
  );
}

/**
 * The step line of a row. Under a narration the "looking up …" label is dropped — the sentence
 * above already says what was read — and the line indents beneath it; alone, the label stays,
 * since the arguments then have nothing naming them. `COMPUTING` keeps its label either way: an
 * expression on its own does not say "computed".
 */
function StepLine({ step, underNarration }: { step: AgentStep; underNarration: boolean }) {
  const computing = step.label === COMPUTING;
  const showLabel = computing || !underNarration;
  return (
    <span
      className={`flex min-w-0 items-start gap-2 ${underNarration ? "pl-[21px]" : ""}`}
      data-step={step.kind}
    >
      <StepIcon computing={computing} />
      <span className="min-w-0 flex-1">
        {showLabel && <span className="text-ink-faint">{step.label}</span>}
        {step.detail !== undefined && (
          <>
            {showLabel && <span className="text-ink-faint/50">{" · "}</span>}
            <Subject detail={step.detail} />
          </>
        )}
      </span>
      {step.endedAt !== null && (
        <span className="shrink-0 text-ink-faint/70 tabular-nums">
          {seconds(step.endedAt - step.startedAt)}
        </span>
      )}
    </span>
  );
}

export function AgentTrail({ steps, live, prose, working }: AgentTrailProps) {
  /**
   * Open while the turn runs, collapsed once it settles — and a reader who toggles it wins, in
   * both directions, for as long as this turn is on screen.
   *
   * Derived rather than synchronised: `useState(live)` plus an effect writing `live` back is a
   * cascading render React's lint rejects, and a second copy of a fact the prop already carries.
   * The only state is whether the reader has expressed a preference; the default falls out of
   * the prop.
   */
  const [choice, setChoice] = useState<boolean | null>(null);
  const open = choice ?? live;

  const first = steps[0];
  const last = steps[steps.length - 1];
  // Read only while live; zero until the first tick, and never below zero.
  const now = useTickingNow(live, ELAPSED_TICK_MS);
  const elapsed = first === undefined ? 0 : Math.max(0, now - first.startedAt);

  if (first === undefined || last === undefined) return null;

  const settledMs = (last.endedAt ?? last.startedAt) - first.startedAt;
  // Live: only what has finished, since the running action is the header. Settled: every concrete
  // step, so the reopened trail is the complete trace.
  const groups = groupSteps(concreteSteps(steps).filter((s) => !live || s.endedAt !== null));
  const excerpt = live ? workingExcerpt(prose ?? "", working ?? "") : "";

  return (
    /*
     * `aria-live="off"`, because the transcript around this is `aria-live="polite"` and would
     * otherwise announce every step as it lands — over the top of the answer arriving, which is
     * the thing a screen-reader user is actually waiting for. The trail stays reachable: it is a
     * `<summary>`, so it is focusable and operable from the keyboard for free.
     */
    <div aria-live="off">
      {/* No `data-popover`: `DismissPopovers` closes anything carrying it on an outside
          click, right for a filter menu and wrong for content the reader deliberately opened. */}
      <details
        className="group"
        open={open}
        /*
         * Only a toggle that disagrees with what we just rendered is the reader's. `toggle`
         * fires for programmatic changes as well as clicks — including when React mounts the
         * element already open — so recording every event would count the first render as the
         * reader opening it. After our own render the element already agrees with `open`; only a
         * click can make it differ.
         */
        onToggle={(e) => {
          if (e.currentTarget.open !== open) setChoice(e.currentTarget.open);
        }}
      >
        <summary className="flex w-fit cursor-pointer list-none items-start gap-2.5 py-0.5 text-sm [&::-webkit-details-marker]:hidden">
          {live ? (
            <>
              <span className="mt-1">
                <PixelGrid />
              </span>
              <span className="shimmer-label font-medium" data-trail-headline>
                {liveHeadline(steps)}
              </span>
              {/* Tabular figures so a ticking timer does not shuffle the row beside it. */}
              <span className="mt-px font-mono text-xs text-ink-faint tabular-nums">
                {seconds(elapsed)}
              </span>
            </>
          ) : (
            // The header is the duration and nothing after it; everything else belongs in the
            // dropdown.
            <span className="text-ink-faint group-hover:text-ink-dim">
              worked for {seconds(settledMs)}
            </span>
          )}
          <span
            aria-hidden
            className="text-ink-faint transition-transform group-open:rotate-90 motion-reduce:transition-none"
          >
            ›
          </span>
        </summary>

        {(groups.length > 0 || excerpt !== "") && (
          /* The rule is the trace's spine, and it stops at the last row rather than running to the
             bottom of the block — a line continuing past the final step reads as a step still to
             come. */
          <ol className="mt-1 ml-[3px] space-y-1 border-l border-edge-faint pl-3.5">
            {groups.map((g, i) => (
              <li
                key={i}
                /*
                 * `items-start`, never `items-center` — the mark belongs to the row's first line.
                 * At 375px a subject wraps to two or three lines, and centring put the icon
                 * wherever that row's height happened to land.
                 */
                className="step-row flex flex-col gap-0.5 py-0.5 font-mono text-xs"
                data-row={g.narration !== undefined && g.step !== undefined ? "grouped" : "single"}
              >
                {g.narration !== undefined && (
                  /*
                   * The model's working, as a plain text node — never `AnswerMarkdown`, so
                   * nothing in it can become a link, image or markup however an injected string
                   * phrased itself (it is also `narrationText`-sanitised server-side; this is
                   * the second, structural stop). No icon, since the marks mean "something was
                   * read/computed", and no duration.
                   */
                  <span className="text-ink-dim" data-step="narration">
                    {g.narration.label}
                  </span>
                )}
                {g.step !== undefined && (
                  <StepLine step={g.step} underNarration={g.narration !== undefined} />
                )}
              </li>
            ))}
            {excerpt !== "" && (
              /*
               * The live working line: the first sentence of the round in flight, a text node
               * with a blinking caret. It is the last thing in the list because it describes
               * what is happening now; on `reset` the console clears `working` and the real
               * narration row lands in this slot, on `done` it clears as the answer commits.
               */
              <li
                className="flex items-start gap-2 py-0.5 font-mono text-xs text-ink-dim"
                data-step="working"
              >
                <span className="min-w-0 flex-1">
                  {excerpt}
                  <span aria-hidden className="working-caret" />
                </span>
              </li>
            )}
          </ol>
        )}
      </details>
    </div>
  );
}
