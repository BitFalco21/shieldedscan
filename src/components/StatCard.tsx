import type { ReactNode } from "react";

export interface StatCardProps {
  label: string;
  /** A node, not just a string, so a value can carry the privacy dots or an accent. */
  value: ReactNode;
  /** A node, not just a string, so deltas can carry their green/red accent. */
  sub?: ReactNode;
}

/**
 * One headline figure: a micro-label, the value, an optional sub-line.
 *
 * Styled by component classes (`.stat-card`, `-value`, `-sub` in `app/styles/components.css`) rather than
 * utilities, so a `StatGrid` can turn the card into a compact row on a phone — a utility would
 * beat that rule. Outside a grid it is the same panel it always was, at the compact density.
 */
export function StatCard({ label, value, sub }: StatCardProps) {
  return (
    <div className="stat-card panel">
      <div className="stat-card-label microlabel">{label}</div>
      <div className="stat-card-value">{value}</div>
      {sub ? <div className="stat-card-sub">{sub}</div> : null}
    </div>
  );
}
