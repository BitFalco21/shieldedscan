"use client";

import { useEffect, useState } from "react";

export interface Nu7ScrambleProps {
  /** The value it resolves to. */
  text: string;
  /** Scramble on mount; false renders `text` as it is. */
  play: boolean;
  /** How long until the last digit locks. */
  durationMs: number;
}

const DIGITS = "0123456789";
const FRAME_MS = 50;

/** `text` with each digit not yet locked replaced by a random one; digits lock left to right. */
function rolled(text: string, elapsed: number, durationMs: number): string {
  return [...text]
    .map((c, i) =>
      /[0-9]/.test(c) && elapsed < (durationMs * (i + 1)) / text.length
        ? DIGITS[Math.floor(Math.random() * DIGITS.length)]
        : c,
    )
    .join("");
}

/**
 * A value whose digits roll and lock one by one, left to right, onto `text`. Only digits roll;
 * the rest (".", " s") stays put. The final value is what assistive tech reads throughout.
 */
export function Nu7Scramble({ text, play, durationMs }: Nu7ScrambleProps) {
  // The first frame is already rolled, so the answer never flashes before the roll. `play` is
  // only ever true on the client, after the tip crossed, so this never meets hydration.
  const [shown, setShown] = useState(() => (play ? rolled(text, 0, durationMs) : text));

  useEffect(() => {
    if (!play) return;
    const start = Date.now();
    const timer = setInterval(() => {
      const elapsed = Date.now() - start;
      if (elapsed >= durationMs) {
        setShown(text);
        clearInterval(timer);
        return;
      }
      setShown(rolled(text, elapsed, durationMs));
    }, FRAME_MS);
    return () => clearInterval(timer);
  }, [play, text, durationMs]);

  return (
    <>
      <span aria-hidden="true">{play ? shown : text}</span>
      <span className="sr-only">{text}</span>
    </>
  );
}
