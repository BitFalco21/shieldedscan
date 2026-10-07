"use client";

import { useContext, useEffect, useReducer, useState } from "react";
import { ZATS_PER_ZEC } from "@/domain";
import { prefersReducedMotion } from "@/lib/use-reduced-motion";
import { CoachPresenceContext } from "./zeno-context";
import { TOUR_WELCOME } from "./tour-script";
import type { TourTarget } from "./tour-script";
import { SimCoach } from "./SimCoach";
import { SimExchange } from "./SimExchange";
import { SimGuide } from "./SimGuide";
import { SimKnows } from "./SimKnows";
import { SimLedger } from "./SimLedger";
import { SimWallet } from "./SimWallet";
import {
  DEFAULT_FRIEND_ZAT,
  SIM_BLOCK_MS,
  initialSimState,
  maxSendZat,
  simHint,
  simReducer,
  validateSend,
} from "./sim-model";
import type { SimState } from "./sim-model";
import { useGuidedRun } from "./use-guided-run";

export interface PracticeSimProps {
  priceUsd: number | null;
  /** False while the real guide is showing: a guided run must not keep pressing hidden buttons. */
  active: boolean;
  onDoItForReal: () => void;
}

/** A ZEC amount as an input value: no ticker, no trailing zeros. */
function asInput(zat: number): string {
  return zat > 0 ? (zat / ZATS_PER_ZEC).toFixed(8).replace(/0+$/, "").replace(/\.$/, "") : "";
}

/** The amount a beginner would most likely send: a little to a friend, or everything back. */
function defaultAmount(s: SimState): string {
  return s.sendTo === "friend" ? asInput(DEFAULT_FRIEND_ZAT) : asInput(maxSendZat(s));
}

/** Which panel a tour target lives in, so the others can step back while Zeno talks about it. */
type Panel = "exchange" | "wallet" | "ledger" | "knows";
const PANEL_OF: Readonly<Record<TourTarget, Panel>> = {
  seed: "wallet",
  buy: "exchange",
  withdraw: "exchange",
  "use-transparent": "exchange",
  shield: "wallet",
  send: "wallet",
  "ledger-new": "ledger",
  knows: "knows",
};

/**
 * The practice half of `/learn`. Everything happens in this component's memory: nothing is sent,
 * nothing is stored, and the addresses cannot receive real ZEC.
 *
 * It opens on Zeno offering the guided tour, because a newcomer knows nothing and should be led
 * first; the reader's own go comes after the tour (or instead of it, if they choose).
 */
export function PracticeSim({ priceUsd, active, onDoItForReal }: PracticeSimProps) {
  const [state, dispatch] = useReducer(simReducer, undefined, () =>
    initialSimState("transparent-only", false),
  );
  const [amount, setAmount] = useState<string | null>(null);
  const [memo, setMemo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const run = useGuidedRun(dispatch, priceUsd);
  const { stop } = run;
  /** Whether the reader has started anything yet: until then Zeno greets them and offers the tour. */
  const [started, setStarted] = useState(false);
  /** Whether the reader has taken the tour: until then free play keeps offering it, prominently. */
  const [toured, setToured] = useState(false);
  const phase: "intro" | "tour" | "done" | "free" = run.running
    ? "tour"
    : run.ended
      ? "done"
      : started
        ? "free"
        : "intro";
  const coaching = phase === "tour" || phase === "done";

  // Tell the page Zeno is on screen as the guide, so the corner launcher steps aside meanwhile.
  const setCoachPresent = useContext(CoachPresenceContext);
  useEffect(() => setCoachPresent(coaching), [coaching, setCoachPresent]);
  useEffect(() => () => setCoachPresent(false), [setCoachPresent]);

  // While Zeno talks about one panel the others step back, so the eye lands where he points.
  const focus = run.running && run.target !== null ? PANEL_OF[run.target] : null;
  const dimmed = (panel: Panel) => focus !== null && focus !== panel;

  // A pending transaction lands in its block after a moment, or at once for reduced motion.
  useEffect(() => {
    if (!state.pending) return;
    const delay = prefersReducedMotion() ? 0 : SIM_BLOCK_MS;
    const id = window.setTimeout(() => dispatch({ type: "confirm" }), delay);
    return () => window.clearTimeout(id);
  }, [state.pending]);

  useEffect(() => {
    if (!active) stop();
  }, [active, stop]);

  /**
   * Every press by the reader goes through here. Pressing the very control the guided run is
   * pointing at is doing what Zeno asked, so the run moves on as if `next` had been pressed — the
   * run's own press is the same action the button would dispatch. Any other press takes over from
   * the run, leaving the reader exactly where it was.
   */
  const readerDoes = (act: () => void, control?: TourTarget): void => {
    setStarted(true);
    if (run.running && control !== undefined && run.highlight === control) {
      run.next();
      return;
    }
    run.stop();
    if (state.tourDone) dispatch({ type: "tourDone", done: false });
    act();
  };
  /** `readerDoes` as a click handler. */
  const byReader = (act: () => void, control?: TourTarget) => (): void => readerDoes(act, control);

  const clearForm = () => {
    setAmount(null);
    setMemo("");
    setError(null);
  };

  const shownAmount = amount ?? defaultAmount(state);

  const startTour = () => {
    setStarted(true);
    setToured(true);
    clearForm();
    run.start();
  };

  return (
    <section
      aria-labelledby="learn-practice-title"
      // Room below the last panel, so it can scroll clear of Zeno's dialogue box.
      className={["grid gap-4", coaching ? "pb-72" : ""].join(" ")}
    >
      <h2 id="learn-practice-title" className="sr-only">
        Practice with test ZEC
      </h2>
      {phase === "intro" || coaching ? (
        <SimCoach
          phase={phase}
          text={phase === "intro" ? TOUR_WELCOME : run.say}
          expression={run.expression}
          step={run.step}
          steps={run.steps}
          onStart={startTour}
          onExplore={() => setStarted(true)}
          onBack={run.back}
          onNext={run.next}
          onExit={run.stop}
          onTryYourself={() => {
            run.stop();
            clearForm();
            dispatch({ type: "reset", exchange: "transparent-only", seedAcknowledged: true });
          }}
          onReplay={startTour}
          onDoItForReal={() => {
            run.stop();
            dispatch({ type: "tourDone", done: false });
            onDoItForReal();
          }}
        />
      ) : null}
      {phase === "free" ? (
        <SimGuide
          hint={simHint(state)}
          offerTour={!toured}
          finished={state.sentPrivately}
          exchange={state.exchange}
          onTour={startTour}
          onOtherExchange={byReader(() => {
            clearForm();
            dispatch({
              type: "reset",
              exchange:
                state.exchange === "transparent-only" ? "accepts-shielded" : "transparent-only",
              seedAcknowledged: true,
            });
          })}
          onDoItForReal={byReader(onDoItForReal)}
          onReset={byReader(() => {
            clearForm();
            dispatch({
              type: "reset",
              exchange: state.exchange,
              seedAcknowledged: state.seedAcknowledged,
            });
          })}
        />
      ) : null}
      <div className="grid items-start gap-4 md:grid-cols-2">
        <SimExchange
          state={state}
          priceUsd={priceUsd}
          highlight={run.highlight}
          dimmed={dimmed("exchange")}
          onBuy={byReader(() => dispatch({ type: "buy", priceUsd }), "buy")}
          onWithdraw={byReader(() => dispatch({ type: "withdraw" }), "withdraw")}
          onUseTransparent={byReader(() => dispatch({ type: "useTransparent" }), "use-transparent")}
        />
        <SimWallet
          state={state}
          highlight={run.highlight}
          dimmed={dimmed("wallet")}
          amount={shownAmount}
          memo={memo}
          error={error}
          onAckSeed={byReader(() => dispatch({ type: "ackSeed" }), "seed")}
          onShield={byReader(() => dispatch({ type: "shield" }), "shield")}
          onView={(view) => readerDoes(() => dispatch({ type: "view", view }))}
          onSendTo={(to) =>
            readerDoes(() => {
              clearForm();
              dispatch({ type: "sendTo", to });
            })
          }
          onAmount={(value) => readerDoes(() => setAmount(value))}
          onMemo={(value) => readerDoes(() => setMemo(value))}
          onMax={byReader(() => {
            setAmount(asInput(maxSendZat(state)));
            setError(null);
          })}
          onSend={byReader(() => {
            const checked = validateSend(state, shownAmount);
            if ("error" in checked) {
              setError(checked.error);
              return;
            }
            dispatch({ type: "send", amountZat: checked.amountZat, memo: memo.trim().length > 0 });
            clearForm();
          }, "send")}
        />
      </div>
      <SimLedger rows={state.ledger} highlight={run.highlight} dimmed={dimmed("ledger")} />
      <SimKnows
        seen={state.seen}
        exchangeKnows={state.exchangeKnows}
        highlight={run.highlight}
        dimmed={dimmed("knows")}
      />
    </section>
  );
}
