import { Zeno } from "@/features/agent/Zeno";
import type { ZenoExpression } from "@/features/agent/zeno-mood";
import { BTN, BTN_PRIMARY } from "./learn-ui";

export interface SimCoachProps {
  /**
   * `intro` is the card that opens the page; `tour` and `done` are the dialogue box pinned to the
   * bottom of the screen while Zeno guides, and when he has finished.
   */
  phase: "intro" | "tour" | "done";
  text: string;
  expression: ZenoExpression;
  step: number;
  steps: number;
  onStart: () => void;
  onExplore: () => void;
  onBack: () => void;
  onNext: () => void;
  onExit: () => void;
  onTryYourself: () => void;
  onReplay: () => void;
  onDoItForReal: () => void;
}

/** Zeno's line, coming out of him: a speech bubble whose tail points at him, popping in per line. */
function Bubble({ text, large }: { text: string; large: boolean }) {
  return (
    <p
      // A new key per line re-mounts the bubble, which is what replays the pop: each line arrives
      // as Zeno says it rather than the text changing silently in place. Never typed out.
      key={text}
      aria-live="polite"
      className={[
        "coach-pop relative min-w-0 flex-1 rounded-lg border border-edge bg-bg px-4 py-3 leading-relaxed text-ink-bright",
        large ? "text-[15px] sm:text-lg" : "text-[15px] sm:text-base",
      ].join(" ")}
    >
      <span
        aria-hidden
        className="absolute top-8 -left-[7px] h-3 w-3 rotate-45 border-b border-l border-edge bg-bg"
      />
      <span aria-hidden className="mr-2 font-bold text-green">
        zeno&gt;
      </span>
      {text}
    </p>
  );
}

/**
 * Zeno, guiding: big, speaking, and always on screen while he does. A newcomer knows nothing, so
 * the page opens on him offering the tour, and during it he sits in a dialogue box at the bottom of
 * the screen saying exactly which button to press — the arrow points at it — while the tour waits
 * for them. At the end he offers the reader their own go, or the tour again.
 *
 * The figure is decorative (`Zeno` is `aria-hidden`); the line is a live region, so a screen reader
 * hears each step as it arrives.
 */
export function SimCoach(props: SimCoachProps) {
  const { phase, text, expression } = props;

  if (phase === "intro") {
    return (
      <section aria-label="Zeno, your guide" className="panel flex flex-col gap-4 p-4 sm:p-6">
        <div className="flex items-start gap-4 sm:gap-6">
          <Zeno expression="ready" bubble={false} className="w-20 shrink-0 sm:w-32" />
          <Bubble text={text} large />
        </div>
        <div className="flex flex-wrap items-center gap-3 sm:pl-38">
          <button
            type="button"
            onClick={props.onStart}
            className={`${BTN_PRIMARY} px-5 py-2.5 text-base`}
          >
            <span aria-hidden>▶ </span>start the tour
          </button>
          <button
            type="button"
            onClick={props.onExplore}
            className="cursor-pointer text-sm text-ink-faint underline-offset-4 hover:text-ink hover:underline"
          >
            or explore on my own
          </button>
        </div>
      </section>
    );
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] sm:px-6">
      <section
        aria-label="Zeno, your guide"
        className="panel pointer-events-auto mx-auto flex max-w-3xl flex-col gap-3 p-3 shadow-2xl sm:p-4"
      >
        <div className="flex items-start gap-3 sm:gap-4">
          <Zeno
            expression={expression}
            bubble={false}
            stage={expression === "answered"}
            className="w-16 shrink-0 sm:w-24"
          />
          <Bubble text={text} large={false} />
        </div>
        {phase === "tour" ? <TourControls {...props} /> : <DoneControls {...props} />}
      </section>
    </div>
  );
}

function TourControls({ step, steps, onBack, onNext, onExit }: SimCoachProps) {
  const last = step >= steps - 1;
  return (
    <div
      role="group"
      aria-label="Guided tour"
      className="flex flex-wrap items-center justify-end gap-2"
    >
      <span className="mr-auto text-xs text-ink-faint tabular-nums">
        <span className="sr-only">step </span>
        {step + 1}
        <span aria-hidden>/</span>
        <span className="sr-only"> of </span>
        {steps}
      </span>
      <button type="button" className={BTN} onClick={onBack} disabled={step === 0}>
        <span aria-hidden>‹ </span>back
      </button>
      <button type="button" className={BTN_PRIMARY} onClick={onNext}>
        {last ? "finish" : "next"}
        <span aria-hidden> ›</span>
      </button>
      <button type="button" className={BTN} onClick={onExit}>
        exit
      </button>
    </div>
  );
}

function DoneControls({ onTryYourself, onReplay, onDoItForReal }: SimCoachProps) {
  return (
    <div role="group" aria-label="After the tour" className="flex flex-wrap justify-end gap-2">
      <button type="button" className={BTN_PRIMARY} onClick={onTryYourself}>
        try it yourself
      </button>
      <button type="button" className={BTN} onClick={onReplay}>
        watch again
      </button>
      <button type="button" className={BTN} onClick={onDoItForReal}>
        do it for real →
      </button>
    </div>
  );
}
