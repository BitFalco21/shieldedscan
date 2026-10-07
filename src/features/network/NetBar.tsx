export interface NetBarProps {
  /** 0..1. Anything above zero draws at least a sliver, so a small share never reads as none. */
  share: number;
  /** A `color` class — the fill is `currentColor`. */
  toneClass: string;
  /** Draw as stripes (Zebra) instead of a solid fill. */
  stripe?: boolean;
  /** Track height in px. */
  height?: 6 | 8;
}

/**
 * A horizontal bar whose length is an SVG `width` attribute — the escape `SupplyBreakdownPanel`
 * takes for runtime geometry, so `src/` keeps its no-inline-style rule. The track is a span in
 * faint ink; the fill inherits the wrapper's colour class.
 *
 * Stripes are a dashed stroke in an SVG with no viewBox, so its user units are CSS pixels and
 * the dash pitch is the same on a 40px bar and a 400px one. A `<pattern>` would need an `id`,
 * which a component rendered once per row must not emit.
 */
export function NetBar({ share, toneClass, stripe = false, height = 8 }: NetBarProps) {
  const pct = share <= 0 ? 0 : Math.max(1, Math.min(100, share * 100));
  const trackSize = height === 6 ? "net-track-mid" : "";
  return (
    <span className={`net-track ${trackSize} ${toneClass}`.trim()} aria-hidden>
      {pct === 0 ? null : (
        <svg className="net-bar" width={`${pct.toFixed(2)}%`} height={height} focusable="false">
          <NetBarFill stripe={stripe} height={height} />
        </svg>
      )}
    </span>
  );
}

export interface NetBarFillProps {
  /** Draw as stripes (Zebra) instead of a solid fill. */
  stripe: boolean;
  /** The bar's height in px, which the stripe's stroke must match. */
  height: number;
}

/** The inside of a bar's `<svg>`: a solid rect, or Zebra's stripes as one dashed stroke. */
export function NetBarFill({ stripe, height }: NetBarFillProps) {
  return stripe ? (
    <>
      <rect className="net-bar-stripe-bed" width="100%" height="100%" />
      <line
        className="net-bar-stripe"
        x1="0"
        y1={height / 2}
        x2="100%"
        y2={height / 2}
        strokeWidth={height}
      />
    </>
  ) : (
    <rect className="net-bar-fill" width="100%" height="100%" />
  );
}
