import type { ReactNode } from "react";

export interface LearnRowProps {
  label: ReactNode;
  value?: ReactNode;
  /**
   * Let a TEXT value wrap. Off by default because an amount is one token and must never break
   * between the number and its ticker; a sentence like "included · has no separate address" must.
   */
  wrap?: boolean;
}

/** One line of a from/to list or a balance: what it is on the left, how much on the right. */
export function LearnRow({ label, value, wrap = false }: LearnRowProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-edge-faint py-1.5 last:border-b-0">
      <span className="min-w-0 text-ink-dim">{label}</span>
      {value === undefined ? null : (
        <span
          className={`text-ink-bright tabular-nums ${wrap ? "min-w-0 text-right" : "whitespace-nowrap"}`}
        >
          {value}
        </span>
      )}
    </div>
  );
}
