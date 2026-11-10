/*
 * Bargraph geometry. 400 user units is 100%, cut into 40 cells of 10 — so one cell is
 * 2.5% and four cells are 10%.
 */
const BAR_W = 400;
const BAR_H = 8;
const CELL_W = 10;
const SEAM_W = 1.6;
/** 0.6% of the track, the floor `SupplyBreakdownPanel` uses, in these units. */
const MIN_FILL = (0.6 / 100) * BAR_W;

/**
 * A share, as a phosphor bargraph: a band's share of transparent value on /rich-list.
 *
 * Cells rather than a rounded pill because the segmentation is the scale: a length can be
 * counted, not only compared. Square ends for the same reason.
 *
 * The FILL is exact and the cells are seams laid over it, so nothing is quantised — a
 * 0.28% band is a sliver inside the first cell, never a cell rounded up to 2.5%. The
 * floor keeps a band that holds something from rendering identically to one that holds
 * nothing.
 *
 * The seams are one `<line>` with a dash pattern, not forty rects per row. A `<pattern>` would
 * need an `id`, shared by every row on the page. Dash lengths are user units scaled with the
 * viewBox, so it stays forty cells at every width.
 *
 * Hidden below `sm`: the percentage beside it says the same thing in a tenth of the width.
 */
export interface CellShareBarProps {
  /** The share, 0–100. */
  pct: number;
}

export function CellShareBar({ pct }: CellShareBarProps) {
  return (
    <svg
      viewBox={`0 0 ${BAR_W} ${BAR_H}`}
      preserveAspectRatio="none"
      className="mt-1 hidden h-2 w-full sm:block"
      aria-hidden
    >
      <rect width={BAR_W} height={BAR_H} className="text-edge-faint" fill="currentColor" />
      <rect
        width={Math.max(pct * (BAR_W / 100), pct > 0 ? MIN_FILL : 0)}
        height={BAR_H}
        className="text-green"
        fill="currentColor"
      />
      <line
        x1={0}
        y1={BAR_H / 2}
        x2={BAR_W}
        y2={BAR_H / 2}
        className="text-panel"
        stroke="currentColor"
        strokeWidth={BAR_H}
        strokeDasharray={`${SEAM_W} ${CELL_W - SEAM_W}`}
        strokeDashoffset={-(CELL_W - SEAM_W)}
      />
    </svg>
  );
}
