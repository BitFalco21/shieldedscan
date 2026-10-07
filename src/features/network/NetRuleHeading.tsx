import type { ReactNode } from "react";

export interface NetRuleHeadingProps {
  children: ReactNode;
}

/** A small uppercase heading followed by a hairline to the edge: it starts one group of bar rows. */
export function NetRuleHeading({ children }: NetRuleHeadingProps) {
  return (
    <div className="mt-2.5 flex items-center gap-2 text-[11px] tracking-[0.14em] text-ink-dim uppercase after:h-px after:flex-1 after:bg-edge-faint after:content-['']">
      {children}
    </div>
  );
}
