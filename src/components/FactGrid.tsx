export interface Fact {
  label: string;
  /** A string for the common case; a node when the value is a link or an amount. */
  value: ReactNode;
  /**
   * One sentence explaining the field, shown behind a `?` beside the label.
   *
   * Optional on purpose: a hint belongs on the fields a newcomer cannot infer — expiry height,
   * binding signature, a value balance — and not on TIME or BLOCK. A `?` on every label teaches
   * a reader to ignore all of them.
   */
  hint?: string;
}

import type { ReactNode } from "react";
import { InfoTip } from "@/components/InfoTip";

export interface FactGridProps {
  facts: Fact[];
  className?: string;
}

/** Grid of labelled panel cards used by every detail page. */
export function FactGrid({
  facts,
  className = "grid gap-3 sm:grid-cols-2 lg:grid-cols-4",
}: FactGridProps) {
  return (
    <div className={className}>
      {facts.map((fact) => (
        <div key={fact.label} className="panel px-4 py-3">
          {/* `relative` is load-bearing: it is the box an InfoTip's panel anchors to, which
              keeps the panel starting at the card's left edge rather than escaping a phone. */}
          <div className="microlabel relative flex items-center">
            {fact.label}
            {fact.hint ? <InfoTip text={fact.hint} label={fact.label.toLowerCase()} /> : null}
          </div>
          <div className="mt-1.5 text-sm break-all text-ink-bright">{fact.value}</div>
        </div>
      ))}
    </div>
  );
}
