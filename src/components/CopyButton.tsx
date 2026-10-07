"use client";

import { useState } from "react";

export interface CopyButtonProps {
  /** Full, untruncated value written to the clipboard — never the shortened display text. */
  value?: string;
  /**
   * Copy the text content of the element with this id instead of `value`, read at click time.
   *
   * For a value already rendered on the page in full — the raw transaction hex — a `value`
   * prop would serialise the same bytes a second time into the RSC payload (megabytes on the
   * widest transactions). The element is the single copy.
   */
  fromElementId?: string;
  /** Noun used in the accessible name, e.g. "Copy block hash". */
  label: string;
  /**
   * Render the word beside the glyph, and drop the leading margin.
   *
   * The default form assumes it follows a value — a hash, an address — which is what makes a
   * bare `⧉` self-explanatory. With no adjacent value, a lone glyph reads as debris. The word
   * goes inside the button: a label beside it would be a dead click target next to a live one.
   */
  withLabel?: boolean;
}

const CONFIRM_MS = 1500;

/**
 * Icon-only clipboard button. Deliberately narrow in scope: no icon library
 * (`⧉` / `✓` glyphs only), and no `document.execCommand` fallback — if the
 * Clipboard API is missing (insecure context) or the write is rejected
 * (denied permission), it fails quietly and leaves the glyph unchanged.
 */
export function CopyButton({ value, fromElementId, label, withLabel = false }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  function handleClick() {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) return;
    const text =
      fromElementId !== undefined
        ? (document.getElementById(fromElementId)?.textContent ?? null)
        : (value ?? null);
    if (text === null) return;
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), CONFIRM_MS);
      })
      .catch(() => {
        // Insecure context or denied permission — nothing the user can act on here.
      });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={`Copy ${label}`}
      className={`cursor-pointer ${withLabel ? "" : "ml-1.5"} ${
        copied ? "text-green" : "text-ink-faint hover:text-green"
      }`}
    >
      {copied ? "✓" : "⧉"}
      {withLabel && <span className="ml-1.5">{copied ? "copied" : "copy"}</span>}
    </button>
  );
}
