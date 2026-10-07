/** The smallest visible fill, in percent of the track, for a share that is not zero. */
export const SHARE_BAR_FLOOR_PCT = 0.6;

export interface ShareBarProps {
  /**
   * The share, in percent. Its magnitude is drawn, so a negative share draws like a positive one;
   * null draws an empty track.
   */
  pct: number | null;
  /** The smallest fill a non-zero share is drawn at, in percent. Default 0.6. */
  floor?: number;
  /** The bar's height in viewBox units; the width is always 100. Default 4. */
  height?: number;
  /** Corner radius of the track and the fill, in viewBox units. */
  rx?: number;
  /** Classes on the `<svg>`, which set its rendered size. */
  className?: string;
  /** Token class colouring the fill through `currentColor`. */
  fillClassName?: string;
  /** Token class colouring the track. Default `text-edge-faint`. */
  trackClassName?: string;
}

/** The fill width for a share: its magnitude, capped at the track, at least `floor` unless zero. */
export function shareBarWidth(pct: number | null, floor: number = SHARE_BAR_FLOOR_PCT): number {
  if (pct === null || pct === 0) return 0;
  return Math.max(Math.min(Math.abs(pct), 100), floor);
}

/**
 * A share drawn as a fill on a faint track. The width is an SVG attribute rather than an inline
 * style, so a proportion needs no class per value. A non-zero share is drawn at least `floor`
 * wide: a part that contributed something must not render identically to one that did not.
 *
 * Decorative: the figure it illustrates is always printed beside it.
 */
export function ShareBar({
  pct,
  floor = SHARE_BAR_FLOOR_PCT,
  height = 4,
  rx,
  className,
  fillClassName,
  trackClassName = "text-edge-faint",
}: ShareBarProps) {
  return (
    <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className={className} aria-hidden>
      <rect width="100" height={height} rx={rx} className={trackClassName} fill="currentColor" />
      <rect
        width={shareBarWidth(pct, floor)}
        height={height}
        rx={rx}
        className={fillClassName}
        fill="currentColor"
      />
    </svg>
  );
}
