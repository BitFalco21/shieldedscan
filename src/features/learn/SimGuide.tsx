import { Zeno } from "@/features/agent/Zeno";
import { BTN, BTN_PRIMARY } from "./learn-ui";

export interface SimGuideProps {
  hint: string;
  /**
   * The reader has not taken the tour yet, so Zeno's offer stays the primary action: pressing a
   * button before starting the tour must not lose the way back to it.
   */
  offerTour: boolean;
  /** Offer the other kind of exchange and the real guide once the reader has sent privately. */
  finished: boolean;
  exchange: "transparent-only" | "accepts-shielded";
  onTour: () => void;
  onOtherExchange: () => void;
  onDoItForReal: () => void;
  onReset: () => void;
}

/**
 * The reader's own go, after the tour or instead of it: one line saying what to do next, pinned to
 * the top while they scroll between the exchange, the wallet and the chain — on a phone those are a
 * screen apart — and the tour one press away.
 */
export function SimGuide({
  hint,
  offerTour,
  finished,
  exchange,
  onTour,
  onOtherExchange,
  onDoItForReal,
  onReset,
}: SimGuideProps) {
  return (
    <div className="panel sticky top-2 z-10 flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <Zeno variant="head" className="w-9 shrink-0" />
      <span className="microlabel text-green">next</span>
      <p aria-live="polite" className="min-w-0 flex-[1_1_16rem] text-sm text-ink-bright">
        {hint}
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={offerTour ? BTN_PRIMARY : BTN} onClick={onTour}>
          <span aria-hidden>▶ </span>guided tour
        </button>
        {finished ? (
          <>
            <button type="button" className={BTN} onClick={onOtherExchange}>
              {exchange === "transparent-only"
                ? "try an exchange that accepts shielded addresses"
                : "try a transparent-only exchange"}
            </button>
            <button type="button" className={BTN_PRIMARY} onClick={onDoItForReal}>
              do it for real →
            </button>
          </>
        ) : null}
        <button type="button" className={BTN} onClick={onReset}>
          reset
        </button>
      </div>
    </div>
  );
}
