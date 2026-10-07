"use client";

import { useEffect, useRef, useState } from "react";
import { useHydrated } from "@/lib/use-hydrated";

/**
 * The cipher set deliberately contains NO digits: a scrambling BALANCE or VALUE bar
 * must never momentarily flash something that reads as a real amount, even at one
 * frame. Spaces and uppercase letters are preserved so the "ZEC" ticker stays put
 * while the bar around it churns.
 */
export const CIPHER_GLYPHS = "abcdefx?#/\\<>+=!;:*~░▒";

export const DECRYPT_VERDICT = "decryption unsuccessful — address protected by cryptography";

const TICK_MS = 55;
const STAGGER_MS = 45;
const MIN_SCRAMBLE_MS = 700;
const MAX_SCRAMBLE_MS = 1200;
const VERDICT_LINGER_MS = 6000;

export function scrambleText(original: string): string {
  let out = "";
  for (const ch of original) {
    out +=
      ch === " " || /[A-Z]/.test(ch)
        ? ch
        : CIPHER_GLYPHS[Math.floor(Math.random() * CIPHER_GLYPHS.length)];
  }
  return out;
}

/**
 * "▶ try to decrypt": every redaction bar scrambles through ciphertext glyphs, then settles
 * back to redaction, and the verdict states why.
 *
 * An enhancement, not a dependency (the `DismissPopovers` shape): the bars are inert
 * server markup found by `data-decrypt-bar`, and the button renders only after mount,
 * so a reader without JavaScript never sees a control that does nothing. The scramble
 * is user-initiated — nothing moves until asked — and under `prefers-reduced-motion`
 * it is skipped entirely: the button just prints the verdict.
 *
 * The status line is a `role="status"` live region mounted while empty (a live region
 * that appears with its text is often not announced).
 */

export function DecryptDemo() {
  // True only after hydration: the server (and a no-JS reader) never gets the button.
  const mounted = useHydrated();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const held = timers.current;
    return () => {
      for (const id of held) {
        window.clearTimeout(id);
        window.clearInterval(id);
      }
    };
  }, []);

  function run() {
    const bars = Array.from(document.querySelectorAll<HTMLElement>("[data-decrypt-bar]"));
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || bars.length === 0) {
      setStatus(DECRYPT_VERDICT);
      timers.current.push(window.setTimeout(() => setStatus(""), VERDICT_LINGER_MS));
      return;
    }
    setBusy(true);
    setStatus("decrypting…");
    let remaining = bars.length;
    bars.forEach((bar, i) => {
      const original = bar.textContent ?? "";
      const start = window.setTimeout(() => {
        const startedAt = performance.now();
        const duration = MIN_SCRAMBLE_MS + Math.random() * (MAX_SCRAMBLE_MS - MIN_SCRAMBLE_MS);
        const tick = window.setInterval(() => {
          if (performance.now() - startedAt >= duration) {
            window.clearInterval(tick);
            bar.textContent = original;
            remaining -= 1;
            if (remaining === 0) {
              setBusy(false);
              setStatus(DECRYPT_VERDICT);
              timers.current.push(window.setTimeout(() => setStatus(""), VERDICT_LINGER_MS));
            }
          } else {
            bar.textContent = scrambleText(original);
          }
        }, TICK_MS);
        timers.current.push(tick);
      }, i * STAGGER_MS);
      timers.current.push(start);
    });
  }

  return (
    <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      {mounted && (
        <button
          type="button"
          onClick={run}
          disabled={busy}
          className="btn btn-primary inline-flex items-center gap-1.5 px-2.5 py-0.5"
        >
          <svg aria-hidden viewBox="0 0 8 8" className="h-2 w-2 fill-current">
            <path d="M1 0l6 4-6 4z" />
          </svg>
          try to decrypt
        </button>
      )}
      <span role="status" className="microlabel text-ink-faint normal-case">
        {status}
      </span>
    </span>
  );
}
