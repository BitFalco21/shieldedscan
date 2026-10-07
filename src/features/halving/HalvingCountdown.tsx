"use client";

import { useEffect, useState } from "react";
import { DAY_SECONDS } from "@/domain";

export interface HalvingCountdownProps {
  /** Unix seconds the halving is estimated to land at, computed on the server. */
  targetSeconds: number;
  /**
   * What the server rendered, and what a reader with no JavaScript keeps: a coarse
   * "2 years, 107 days". Passed in rather than derived here so the two can never disagree
   * about the same instant.
   */
  fallback: string;
}

const UNITS: [label: string, unit: string, seconds: number][] = [
  ["d", "DAYS", DAY_SECONDS],
  ["h", "HRS", 3_600],
  ["m", "MIN", 60],
  ["s", "SEC", 1],
];

/** Split a positive second count into the four display units. */
function parts(totalSeconds: number): { label: string; unit: string; value: number }[] {
  let rest = Math.max(0, Math.floor(totalSeconds));
  return UNITS.map(([label, unit, size]) => {
    const value = Math.floor(rest / size);
    rest -= value * size;
    return { label, unit, value };
  });
}

/**
 * The box every state renders into.
 *
 * Fixed height on purpose: the server paints `fallback` and the ticking cells replace it
 * after hydration, and without this the tallest element on the page would jump.
 */
const SHELL = "flex min-h-[5.25rem] items-center justify-center sm:min-h-[7rem]";

/**
 * The ticking clock in the hero.
 *
 * The page's one client component. Two rules govern it:
 *
 * 1. It must not read the clock during render: server and browser run at different instants,
 *    so that would be a hydration mismatch. The first paint is the server's `fallback`, and the
 *    ticking figure appears only after `useEffect`, which is why `remaining` starts null.
 * 2. Without JavaScript it degrades to something true: the fallback is a real estimate at a
 *    coarser grain, and the target is itself an estimate whose error is measured in days.
 *
 * No `suppressHydrationWarning`: server and client render the same markup until the effect.
 */
export function HalvingCountdown({ targetSeconds, fallback }: HalvingCountdownProps) {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setRemaining(targetSeconds - Math.floor(Date.now() / 1000));
    tick();
    const timer = setInterval(tick, 1_000);
    return () => clearInterval(timer);
  }, [targetSeconds]);

  // Every state occupies the same box. The server paints the fallback and the cells appear
  // on hydration, so without a fixed height that swap is a layout shift on the tallest
  // element of the page — and the e2e suite holds a CLS budget.
  if (remaining === null) {
    return (
      <div className={SHELL}>
        <div className="crt-digit font-mono text-3xl font-extrabold tracking-tight text-ink-bright sm:text-4xl">
          {fallback}
        </div>
      </div>
    );
  }

  // Past the estimate and still not mined: the estimate was an estimate. Say that rather
  // than counting up into negative numbers, which would read as a broken clock.
  if (remaining <= 0) {
    return (
      <div className={SHELL}>
        <div className="crt-digit font-mono text-3xl font-extrabold tracking-tight text-ink-bright sm:text-4xl">
          due now
        </div>
      </div>
    );
  }

  return (
    <div
      className={`${SHELL} gap-1.5 sm:gap-2.5`}
      // A live region would announce every second, which is unusable. The value is readable
      // on demand, and the estimated date beneath it is the accessible answer.
      aria-live="off"
    >
      {parts(remaining).map(({ label, unit, value }) => (
        <div
          key={label}
          className={`halving-cell rounded-sm border border-edge-faint px-2 pt-2.5 pb-1.5 text-center sm:px-4 sm:pt-3 sm:pb-2 ${
            label === "d" ? "min-w-[4.5rem] sm:min-w-[8rem]" : "min-w-[3.25rem] sm:min-w-[5.25rem]"
          }`}
        >
          <div className="crt-digit font-mono text-3xl leading-none font-extrabold tabular-nums sm:text-[2.75rem]">
            {label === "d" ? value : String(value).padStart(2, "0")}
          </div>
          <div className="microlabel mt-1.5 text-ink-faint sm:mt-2">{unit}</div>
        </div>
      ))}
      {/* The same blinking block the logo uses, so "live" is signalled in the site's own
          vocabulary. Decorative: the figures beside it already say the same thing. */}
      <span
        className="cursor-block logo-cursor ml-1 self-start text-3xl sm:ml-2 sm:text-[2.75rem]"
        aria-hidden="true"
      />
    </div>
  );
}
