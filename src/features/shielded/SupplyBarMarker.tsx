export interface SupplyBarMarkerProps {
  /** The highlighted segment, in the bar's units (percent of the cap), or null for none. */
  segment: { start: number; pct: number } | null;
  /** The callout's words: the part's name, and its amount and share. */
  label: string;
  figure: string;
}

/**
 * The callout and bracket above the 21M bar, pointing at the highlighted segment so a sliver of
 * a pixel can still be found. Drawn in the bar's own units with strokes that do not scale, so it
 * lines up with the segment at any width without an inline style; the text sits at the edge
 * nearer the segment, with a leader from there. Always the same height, so highlighting never
 * moves the bar. Hidden from assistive tech: the pressed legend button already names the part,
 * and the bar announces the selection itself.
 */
export function SupplyBarMarker({ segment, label, figure }: SupplyBarMarkerProps) {
  const centre = segment === null ? 0 : segment.start + segment.pct / 2;
  const fromRight = centre > 50;
  return (
    <div aria-hidden>
      <p
        className={`flex h-4 items-baseline gap-1.5 overflow-hidden text-xs whitespace-nowrap ${
          fromRight ? "justify-end" : "justify-start"
        }`}
      >
        {segment === null ? null : (
          <>
            <span className="text-ink-bright">{label}</span>
            <span className="text-ink-dim tabular-nums">{figure}</span>
          </>
        )}
      </p>
      <svg
        viewBox="0 0 100 10"
        preserveAspectRatio="none"
        className="mt-0.5 block h-2.5 w-full overflow-visible text-ink-dim"
      >
        {segment === null ? null : (
          <path
            d={`M ${fromRight ? 100 : 0} 1 H ${centre} V 5 M ${segment.start} 10 V 5 H ${
              segment.start + segment.pct
            } V 10`}
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
    </div>
  );
}
