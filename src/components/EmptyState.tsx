import type { ReactNode } from "react";

export interface EmptyStateProps {
  /** The one line: what is empty, said as a finding rather than an error. */
  children: ReactNode;
  /** A second, quieter line — where a record begins, how to widen what was asked. */
  note?: ReactNode;
  /**
   * `true` inside a panel, where a second panel would be a box in a box: the same type and
   * spacing in a dashed well instead. A page-level empty state (in place of a list's panel) is
   * itself the panel.
   */
  inset?: boolean;
  /** Layout only — a margin. */
  className?: string;
}

/**
 * What a list shows when nothing matches: one type size, one alignment, one padding, and a
 * frame chosen by where it sits.
 *
 * Never the Veil: an empty list is a measurement (nothing matched), and redaction bars mean
 * "encrypted on-chain".
 */
export function EmptyState({ children, note, inset = false, className = "" }: EmptyStateProps) {
  const frame = inset ? "rounded-md border border-dashed border-edge" : "panel";
  return (
    <div className={`${frame} px-5 py-8 text-center text-sm text-ink-dim ${className}`.trim()}>
      <p>{children}</p>
      {note === undefined ? null : (
        <p className="mx-auto mt-2 max-w-lg text-xs text-ink-faint">{note}</p>
      )}
    </div>
  );
}
