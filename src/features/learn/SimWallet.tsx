import { PrivacyShield } from "@/components/PrivacyShield";
import { formatZec } from "@/lib/format";
import { LearnAddress } from "./LearnAddress";
import { BOX, BTN, BTN_ON, BTN_PRIMARY, CHIP, DIMMED, PANEL_FADE, RING } from "./learn-ui";
import { TourArrow } from "./TourArrow";
import { SIM_ADDRESSES, SIM_FEES, sendFeeZat } from "./sim-model";
import type { SimState } from "./sim-model";

export interface SimWalletProps {
  state: SimState;
  highlight: string | null;
  /** The tour is pointing at another panel. */
  dimmed: boolean;
  amount: string;
  memo: string;
  error: string | null;
  onAckSeed: () => void;
  onShield: () => void;
  onView: (view: "receive" | "send") => void;
  onSendTo: (to: "friend" | "deposit") => void;
  onAmount: (value: string) => void;
  onMemo: (value: string) => void;
  onMax: () => void;
  onSend: () => void;
}

/**
 * A test wallet that behaves like the real ones (Zodl's support pages describe the same
 * flow): two addresses, a Shield button once a transparent balance arrives, and spending from
 * the shielded balance only.
 */
export function SimWallet({
  state,
  highlight,
  dimmed,
  amount,
  memo,
  error,
  onAckSeed,
  onShield,
  onView,
  onSendTo,
  onAmount,
  onMemo,
  onMax,
  onSend,
}: SimWalletProps) {
  const busy = state.pending !== null;
  const friend = state.sendTo === "friend";
  const ring = (id: string) => (highlight === id ? RING : "");

  return (
    <section
      aria-label="Test wallet"
      className={[
        "panel flex min-w-0 flex-col gap-3 rounded-2xl p-4",
        PANEL_FADE,
        dimmed ? DIMMED : "",
      ].join(" ")}
    >
      <header className="flex items-center justify-between gap-2">
        <h3 className="microlabel text-ink-bright">wallet</h3>
        <span className={`${CHIP} border-dashed border-edge-faint text-ink-faint`}>test</span>
      </header>

      {state.seedAcknowledged ? null : (
        <div className="grid justify-items-start gap-2 rounded border border-warn-edge px-3 py-2 text-sm text-ink">
          <span>
            <b className="font-semibold text-warn">New wallet.</b> A real wallet shows your recovery
            phrase now. Write it on paper; never type it into a website.
          </span>
          <button
            id="learn-seed"
            type="button"
            onClick={onAckSeed}
            className={`relative ${BTN} ${ring("seed")}`}
          >
            got it
            <TourArrow on={highlight === "seed"} />
          </button>
        </div>
      )}

      <div className={`${BOX} grid gap-1`}>
        <div className="flex items-center gap-2.5 py-1">
          <PrivacyShield variant="shielded" />
          <span className="flex-1 text-ink-dim">shielded</span>
          <span className="text-ink-bright tabular-nums">{formatZec(state.shieldedZat)}</span>
        </div>
        <div className="flex items-center gap-2.5 border-t border-edge-faint py-1">
          <PrivacyShield variant="transparent" />
          <span className="flex-1 text-ink-dim">transparent</span>
          <span className="text-ink-bright tabular-nums">{formatZec(state.transparentZat)}</span>
        </div>
      </div>

      {state.transparentZat > 0 ? (
        <div className="grid justify-items-start gap-2 rounded border border-edge bg-green-wash px-3 py-2 text-sm text-ink-bright">
          <span>
            Transparent ZEC is public.{" "}
            <span className="text-xs text-ink-faint">
              Shielding fee {formatZec(SIM_FEES.shielding)}.
            </span>
          </span>
          <button
            id="learn-shield"
            type="button"
            disabled={busy}
            onClick={onShield}
            className={`relative ${BTN_PRIMARY} ${ring("shield")}`}
          >
            shield {formatZec(state.transparentZat)}
            <TourArrow on={highlight === "shield"} />
          </button>
        </div>
      ) : null}

      <div role="group" aria-label="Wallet screen" className="flex gap-2">
        {(["receive", "send"] as const).map((view) => (
          <button
            key={view}
            type="button"
            aria-pressed={state.walletView === view}
            onClick={() => onView(view)}
            className={state.walletView === view ? BTN_ON : BTN}
          >
            {view}
          </button>
        ))}
      </div>

      {state.walletView === "receive" ? (
        <div className={BOX}>
          <div className="border-b border-edge-faint py-1.5">
            <div className="microlabel">shielded address · use this</div>
            <div className="mt-0.5 text-sm">
              <LearnAddress address={SIM_ADDRESSES.yourShielded} />
            </div>
          </div>
          <div className="py-1.5">
            <div className="microlabel">transparent address · only if an exchange needs it</div>
            <div className="mt-0.5 text-sm">
              <LearnAddress address={SIM_ADDRESSES.yourTransparent} />
            </div>
          </div>
          <p className="mt-1 text-xs text-ink-faint">Test addresses: real wallets reject them.</p>
        </div>
      ) : (
        <form
          className="grid gap-3"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            onSend();
          }}
        >
          <fieldset className="grid gap-1.5">
            <legend className="microlabel mb-1.5">send to</legend>
            <label className="flex cursor-pointer items-baseline gap-2 text-sm text-ink">
              <input
                type="radio"
                name="learn-send-to"
                checked={friend}
                onChange={() => onSendTo("friend")}
                className="accent-green"
              />
              a friend’s shielded address
            </label>
            <label className="flex cursor-pointer items-baseline gap-2 text-sm text-ink">
              <input
                type="radio"
                name="learn-send-to"
                checked={!friend}
                onChange={() => onSendTo("deposit")}
                className="accent-green"
              />
              the exchange’s deposit address (t1…)
            </label>
          </fieldset>
          <div className="grid gap-1.5">
            <label htmlFor="learn-amount" className="microlabel">
              amount (ZEC)
            </label>
            <div className="flex gap-2">
              <input
                id="learn-amount"
                inputMode="decimal"
                autoComplete="off"
                value={amount}
                onChange={(event) => onAmount(event.target.value)}
                className="w-full min-w-0 rounded-sm border border-edge-faint bg-bg px-2.5 py-1.5 text-sm text-ink-bright focus:border-green-dim focus:outline-none"
              />
              <button type="button" onClick={onMax} className={BTN}>
                max
              </button>
            </div>
          </div>
          <div className="grid gap-1.5">
            <label htmlFor="learn-memo" className="microlabel">
              memo
            </label>
            <input
              id="learn-memo"
              autoComplete="off"
              maxLength={80}
              disabled={!friend}
              value={friend ? memo : ""}
              placeholder={
                friend ? "only your friend can read it" : "memos need a shielded address"
              }
              onChange={(event) => onMemo(event.target.value)}
              className="w-full min-w-0 rounded-sm border border-edge-faint bg-bg px-2.5 py-1.5 text-sm text-ink-bright placeholder:text-ink-faint focus:border-green-dim focus:outline-none disabled:opacity-50"
            />
          </div>
          <p className="text-xs text-ink-faint">
            network fee {formatZec(sendFeeZat(state.sendTo))}
            {friend ? "" : " · this is unshielding"}
          </p>
          {error ? (
            <p role="alert" className="text-sm text-red">
              {error}
            </p>
          ) : null}
          <div>
            <button
              id="learn-send"
              type="submit"
              disabled={busy}
              className={`relative ${BTN_PRIMARY} ${ring("send")}`}
            >
              send
              <TourArrow on={highlight === "send"} />
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
