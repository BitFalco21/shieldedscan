"use client";

import { useEffect, useState } from "react";
import { nowSeconds } from "./clock";

/**
 * The clock a page measures relative ages against.
 *
 * The wall clock, not the chain tip: anchored on the tip, the newest block would read "0s ago"
 * until the next one arrived, and indefinitely if the chain stalled. This is safe because
 * `timeAgo` clamps at zero, so a miner timestamp ahead of real time reads "0s".
 *
 * It is a hook rather than `Date.now()` in render for two reasons:
 *  - It returns the server's value on the first render, so hydration matches the server HTML;
 *    without JavaScript a reader keeps the server's age.
 *  - It never reports a time earlier than the server's, so a reader whose machine is set behind
 *    the chain falls back to tip-anchored ages.
 */

/**
 * One second, because below a minute `timeAgo` reports whole seconds and a coarser tick shows
 * a counter jumping in steps. The re-render is a handful of text nodes.
 */
const TICK_MS = 1_000;

export function useDisplayNow(serverNow: number): number {
  const [now, setNow] = useState(serverNow);

  useEffect(() => {
    const sync = () => setNow(Math.max(nowSeconds(), serverNow));
    // Immediately as well as on the interval: a reader who refreshes after fifteen seconds
    // should not wait another second to see the right number.
    sync();
    const timer = setInterval(sync, TICK_MS);
    return () => clearInterval(timer);
  }, [serverNow]);

  // `serverNow` moving forward — a new block — must win at once rather than at the next tick,
  // because every other row's age on the page is about to be re-measured against it.
  return Math.max(now, serverNow);
}
