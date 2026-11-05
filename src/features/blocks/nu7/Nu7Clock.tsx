import { Fragment } from "react";
import { clockParts } from "./nu7-countdown";

export interface Nu7ClockProps {
  /** Seconds until the estimated activation; re-measured from each new block. */
  seconds: number;
  /** The block target the estimate assumes, printed so the clock never reads as a promise. */
  spacingSeconds: number;
  /** Blocks still to come: past the estimate, only the last one is "any moment". */
  blocksToGo: number;
}

/**
 * The estimate as a ticking clock under the block count. Blocks decide the activation, so the
 * count stays the hero and this is marked as an estimate: it jumps when a block lands early or
 * late. A timer role is not announced on every tick.
 */
export function Nu7Clock({ seconds, spacingSeconds, blocksToGo }: Nu7ClockProps) {
  const parts = clockParts(seconds);
  return (
    <div role="timer" aria-label="Estimated time to activation" className="mt-4">
      {parts === null ? (
        <p className="text-[22px] font-extrabold text-ink-bright">
          {blocksToGo <= 1 ? "any moment" : "past the estimate"}
        </p>
      ) : (
        <div className="flex items-start gap-1.5 sm:gap-2">
          <span aria-hidden="true" className="nu7-clock-digit text-ink-faint">
            ≈
          </span>
          {parts.map((part, i) => (
            <Fragment key={part.label}>
              {i > 0 ? (
                <span aria-hidden="true" className="nu7-clock-digit text-ink-faint">
                  :
                </span>
              ) : null}
              <span className="flex flex-col items-center">
                <span className="nu7-clock-digit text-ink-bright">{part.value}</span>
                <span className="microlabel text-ink-faint">{part.label}</span>
              </span>
            </Fragment>
          ))}
        </div>
      )}
      <p className="mt-1.5 text-xs text-ink-faint">estimate · {spacingSeconds} s per block</p>
    </div>
  );
}
