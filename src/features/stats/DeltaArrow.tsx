export interface DeltaArrowProps {
  /** The change itself; only its sign is read. */
  change: number;
}

/**
 * ▲ or ▼ before a change printed as a magnitude (`formatDeltaPct` drops the sign), so the arrow
 * carries the direction; colour alone never does.
 *
 * The glyph is hidden from assistive technology, which would read "black down-pointing
 * triangle"; the word beside it is what a screen reader hears. An exact zero draws nothing:
 * unchanged is a measurement, and an arrow would claim a direction the data does not have.
 */
export function DeltaArrow({ change }: DeltaArrowProps) {
  if (change === 0) return null;
  const up = change > 0;
  return (
    <>
      <span aria-hidden>{up ? "▲" : "▼"}</span>
      <span className="sr-only">{up ? "up" : "down"}</span>{" "}
    </>
  );
}
