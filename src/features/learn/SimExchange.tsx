import { formatUsdExact, formatZec } from "@/lib/format";
import { LearnAddress } from "./LearnAddress";
import { LearnRow } from "./LearnRow";
import { AskZeno } from "./AskZeno";
import { TourArrow } from "./TourArrow";
import { BOX, BTN, BTN_PRIMARY, CHIP, DIMMED, PANEL_FADE, RING } from "./learn-ui";
import { BUY_ZAT, SIM_ADDRESSES, buyCostCents } from "./sim-model";
import type { SimState } from "./sim-model";

export interface SimExchangeProps {
  state: SimState;
  priceUsd: number | null;
  highlight: string | null;
  /** The tour is pointing at another panel. */
  dimmed: boolean;
  onBuy: () => void;
  onWithdraw: () => void;
  onUseTransparent: () => void;
}

/**
 * A test exchange, generic on purpose: putting a real company's name and look on a fake one
 * would impersonate it. Its withdrawal form starts with the wallet's shielded address, which is
 * what a reader should always try first; most exchanges refuse it, as this one does on run one.
 */
export function SimExchange({
  state,
  priceUsd,
  highlight,
  dimmed,
  onBuy,
  onWithdraw,
  onUseTransparent,
}: SimExchangeProps) {
  const cost = buyCostCents(priceUsd);
  const canBuy = !state.pending && (cost === null || state.cashCents >= cost);
  const canWithdraw = state.exchangeZat > 0 && !state.pending && !state.refused;
  const toTransparent = state.withdrawTo === "transparent";
  // The wallet's note comes first, so on arrival the one green action is Zeno's offer to show how.
  const buyIsNext =
    state.seedAcknowledged &&
    state.exchangeZat === 0 &&
    state.transparentZat === 0 &&
    state.shieldedZat === 0;
  const ring = (id: string) => (highlight === id ? RING : "");

  return (
    <section
      aria-label="Test exchange"
      className={["panel flex min-w-0 flex-col gap-3 p-4", PANEL_FADE, dimmed ? DIMMED : ""].join(
        " ",
      )}
    >
      <header className="flex items-center justify-between gap-2">
        <h3 className="microlabel text-ink-bright">exchange</h3>
        <span className={`${CHIP} border-dashed border-edge-faint text-ink-faint`}>test</span>
      </header>
      {state.exchange === "accepts-shielded" ? (
        <p className="text-xs text-ink-faint">Like Gemini, this one accepts shielded addresses.</p>
      ) : null}
      <div className={BOX}>
        {priceUsd !== null ? (
          <LearnRow label="cash" value={formatUsdExact(state.cashCents / 100)} />
        ) : null}
        <LearnRow label="ZEC" value={formatZec(state.exchangeZat)} />
      </div>
      <div>
        <button
          id="learn-buy"
          type="button"
          disabled={!canBuy}
          onClick={onBuy}
          className={`relative ${buyIsNext ? BTN_PRIMARY : BTN} ${ring("buy")}`}
        >
          buy {formatZec(BUY_ZAT)}
          {cost === null ? "" : ` for ${formatUsdExact(cost / 100)}`}
          <TourArrow on={highlight === "buy"} />
        </button>
      </div>
      <p className="microlabel">withdraw to your wallet</p>
      <div className={BOX}>
        <div className="microlabel text-ink-faint">
          to · your {toTransparent ? "transparent" : "shielded"} address
        </div>
        <div className="mt-1 text-sm">
          <LearnAddress
            address={toTransparent ? SIM_ADDRESSES.yourTransparent : SIM_ADDRESSES.yourShielded}
          />
        </div>
      </div>
      {state.refused ? (
        <div
          role="alert"
          className="grid justify-items-start gap-2 rounded border border-warn-edge px-3 py-2 text-sm text-ink"
        >
          <span>
            <b className="font-semibold text-warn">Invalid address.</b> This exchange only sends to
            transparent addresses (they start with t1).
          </span>
          <button
            id="learn-use-transparent"
            type="button"
            onClick={onUseTransparent}
            className={`relative ${BTN_PRIMARY} ${ring("use-transparent")}`}
          >
            use my transparent address
            <TourArrow on={highlight === "use-transparent"} />
          </button>
          <AskZeno question="Why will most exchanges only send my ZEC to a transparent address?" />
        </div>
      ) : null}
      <div>
        <button
          id="learn-withdraw"
          type="button"
          disabled={!canWithdraw}
          onClick={onWithdraw}
          className={`relative ${canWithdraw && !state.deposited ? BTN_PRIMARY : BTN} ${ring("withdraw")}`}
        >
          withdraw{state.exchangeZat > 0 ? ` ${formatZec(state.exchangeZat)}` : ""}
          <TourArrow on={highlight === "withdraw"} />
        </button>
      </div>
    </section>
  );
}
