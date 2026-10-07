export interface InfoTipProps {
  /** One sentence, in a reader's terms. Not a field name restated. */
  text: string;
  /** What the tip explains, for the button's spoken name — "fee", not "this". */
  label: string;
}

/**
 * A `?` beside a label that explains the field on hover or focus.
 *
 * No JavaScript: a `<button>` inside a `group`, with the panel revealed by `group-hover` /
 * `group-focus-within`, so it works in a Server Component and costs no hydration.
 *
 *  - Hidden with `hidden`, not `opacity-0`: an absolutely positioned element contributes to an
 *    ancestor's scrollable overflow even at zero opacity; `display: none` contributes nothing.
 *  - Anchored to the label row, not to the `?`. The button sits after the label text, so
 *    anchoring there would start the panel partway across the card and run off a phone behind
 *    a long label. The wrapper therefore carries no `relative`; the caller supplies the
 *    positioned ancestor. `e2e/tooltips.spec.ts` opens every tip and checks containment.
 *
 * A real `<button>` rather than a `<span title>`: a native tooltip is unreachable by keyboard,
 * invisible to touch, and announced inconsistently. `aria-describedby` ties the two together
 * so the description is read as a description, not as a second label.
 */
export function InfoTip({ text, label }: InfoTipProps) {
  // Deterministic from the content, so a page with two identical tips still produces stable
  // markup — no counters, no randomness, nothing that could differ between server and client.
  const id = `tip-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <span className="group ml-1 inline-flex align-middle">
      <button
        type="button"
        aria-describedby={id}
        aria-label={`What is ${label}?`}
        className="flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full border border-edge-faint text-[9px] leading-none text-ink-faint transition-colors group-hover:border-edge group-hover:text-green focus-visible:text-green"
      >
        ?
      </button>
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none absolute top-full left-0 z-30 mt-1.5 hidden w-56 max-w-[70vw] rounded-md border border-edge bg-panel px-2.5 py-2 text-xs leading-relaxed font-normal tracking-normal whitespace-normal text-ink-dim normal-case shadow-lg group-focus-within:block group-hover:block"
      >
        {text}
      </span>
    </span>
  );
}
