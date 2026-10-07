/** What a redaction bar means, as a screen reader announces it. */
export const REDACTED_LABEL = "value shielded — encrypted on-chain";

/** The tooltip on a redaction bar. */
export const REDACTED_TITLE = "hidden by design — encrypted on-chain";

/** The glyph a redaction bar is drawn in. */
export const REDACTION_GLYPH = "▓";

export interface RedactedProps {
  /**
   * The bar's width as a count of glyphs (default 6), or the exact text to show, for a bar whose
   * glyphs are animated by its caller.
   */
  glyphs?: number | string;
  /** Overrides the spoken name, for a bar that stands for something more specific. */
  label?: string;
  /**
   * Hides the bar from assistive technology, for bars that illustrate rather than state a value
   * (one accessible sentence elsewhere says what they mean).
   */
  decorative?: boolean;
  /** Extra classes beside `redact`, typically the text size. */
  className?: string;
}

/**
 * The Veil in its inline form: a glowing redaction bar standing in for a value that is
 * encrypted on-chain. Never used for a value we merely failed to read — that is `Unmeasured`.
 *
 * The bar is a single image to a screen reader: `role="img"` with a name stating what it means,
 * since the glyphs themselves are decoration.
 */
export function Redacted({ glyphs = 6, label, decorative = false, className }: RedactedProps) {
  const text = typeof glyphs === "number" ? REDACTION_GLYPH.repeat(glyphs) : glyphs;
  const classes = className ? `redact ${className}` : "redact";
  if (decorative) {
    return (
      <span aria-hidden className={classes}>
        {text}
      </span>
    );
  }
  return (
    <span
      role="img"
      aria-label={label ?? REDACTED_LABEL}
      title={REDACTED_TITLE}
      className={classes}
    >
      {text}
    </span>
  );
}
