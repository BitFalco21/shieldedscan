export interface LabelIconProps {
  className?: string;
}

/**
 * A price-tag mark drawn before an address's name, so a name reads as a label someone gave the
 * address rather than as the address itself — which matters most where the name REPLACES it.
 * Drawn as SVG in `currentColor`: no mono font is known to carry a tag glyph. No `id`
 * anywhere, so a table of named rows emits no duplicate ids. Decorative: the name beside it
 * is what a screen reader hears.
 */
export function LabelIcon({ className = "" }: LabelIconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden
      data-label-icon
      className={`h-3 w-3 shrink-0 ${className}`.trim()}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    >
      <path d="M2 2.75v4.5L8.75 14 14 8.75 7.25 2H2.75z" />
      <circle cx="5.25" cy="5.25" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}
