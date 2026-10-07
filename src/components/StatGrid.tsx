import type { ReactNode } from "react";

export interface StatGridProps {
  /**
   * How many cards share a row on a wide screen (`lg`). Between `sm` and `lg` a four- or
   * five-card grid sits two to a row; a two- or three-card grid keeps its count from `sm`.
   */
  columns?: 2 | 3 | 4 | 5;
  /** Layout only — a margin. The grid's gap and phone form are the component's. */
  className?: string;
  /** `StatCard`s, as DIRECT children: the phone form styles `.stat-grid > .stat-card`. */
  children: ReactNode;
}

/** Static strings, so Tailwind's scanner sees every class. */
const COLUMNS: Record<NonNullable<StatGridProps["columns"]>, string> = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-2 lg:grid-cols-4",
  5: "sm:grid-cols-2 lg:grid-cols-5",
};

/**
 * A row of `StatCard`s.
 *
 * From `sm` up it is a card grid. Below `sm` it becomes one panel with each card as a compact
 * row — label and sub-line left, value right and never broken mid-number, a hairline between —
 * because four stacked cards would cost a whole phone screen before the list. The phone form
 * is CSS (`.stat-grid`), so it holds with JavaScript off.
 */
export function StatGrid({ columns = 4, className = "", children }: StatGridProps) {
  return <div className={`stat-grid ${COLUMNS[columns]} ${className}`.trim()}>{children}</div>;
}
