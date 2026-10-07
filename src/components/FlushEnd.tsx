import type { ReactNode } from "react";

export interface FlushEndProps {
  /** The header label. A plain string is pulled flush; any other node renders unchanged. */
  children: ReactNode;
}

/**
 * A right-aligned table header's label, pulled flush with the figures beneath it.
 *
 * `.microlabel` tracks every letter by 0.18em, the last one included, so a right-aligned label
 * ends ~2px short of the column's edge. The trailing tracking is removed at its source — the
 * last letter sits in a span with no letter-spacing — rather than by a negative margin, which
 * would move the label's box past the cell and overflow a last column whose padding is zero.
 *
 * `DataTable` applies it to every right-aligned column; a hand-written table uses it directly.
 */
export function FlushEnd({ children }: FlushEndProps) {
  if (typeof children !== "string" || children.length === 0) return <>{children}</>;
  // By code point, so a label ending in a character outside the BMP is not split in half.
  const letters = Array.from(children);
  const last = letters.pop();
  return (
    <>
      {letters.join("")}
      <span className="tracking-normal">{last}</span>
    </>
  );
}
