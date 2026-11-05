import { Fragment } from "react";
import { clockParts } from "./nu7-countdown";

export interface Nu7ClockProps {
  /** Seconds until the estimated activation; re-measured from each new block. */
  seconds: number;
  /** The block target the estimate assumes, printed so the clock never reads as a promise. */
  spacingSeconds: number;
  /** Blocks still to come: past the estimate, only the last one is "any moment". */
  blocksToGo: number;
  /**
   * The activation block is in: the clock holds at zero in place rather than leaving, so nothing
   * on the page moves at the moment readers are watching.
   */
  arrived?: boolean;
}

const ZERO: ReturnType<typeof clockParts> = [
  { label: "hrs", value: "00" },
  { label: "min", value: "00" },
  { label: "sec", value: "00" },
];

/**
 * The estimate as a ticking clock under the block count. Blocks decide the activation, so the
 * count stays the hero and this is marked as an estimate: it jumps when a block lands early or
 * late. A timer role is not announced on every tick.
 */
export function Nu7Clock({ seconds, spacingSeconds, blocksToGo, arrived = false }: Nu7ClockProps) {
  const parts = arrived ? ZERO : clockParts(seconds);
  const digit = arrived ? "text-warn" : "text-ink-bright";
  return (
    <div
      role="timer"
      aria-label={arrived ? "Activation reached" : "Estimated time to activation"}
      className="mt-4"
    >
      {parts === null ? (
        <p className="text-[22px] font-extrabold text-ink-bright">
          {blocksToGo <= 1 ? "any moment" : "past the estimate"}
        </p>
      ) : (
        <div className="flex items-start gap-1.5 sm:gap-2">
          <span aria-hidden="true" className="nu7-clock-digit text-ink-faint">
            {arrived ? "\u00a0" : "≈"}
          </span>
          {parts.map((part, i) => (
            <Fragment key={part.label}>
              {i > 0 ? (
                <span aria-hidden="true" className="nu7-clock-digit text-ink-faint">
                  :
                </span>
              ) : null}
              <span className="flex flex-col items-center">
                <span className={`nu7-clock-digit ${digit}`}>{part.value}</span>
                <span className="microlabel text-ink-faint">{part.label}</span>
              </span>
            </Fragment>
          ))}
        </div>
      )}
      <p className="mt-1.5 text-xs text-ink-faint">
        {arrived ? "NU7 is active" : "estimate"} · {spacingSeconds} s per block
      </p>
    </div>
  );
}
