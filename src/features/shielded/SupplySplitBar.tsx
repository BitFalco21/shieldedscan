import type { AllPoolsSupply } from "@/domain";
import { supplyBarSegments } from "@/domain";
import { formatSharePct } from "@/lib/format";
import { Unmeasured } from "@/components/Unmeasured";
import { supplyPartMeta } from "./supply-part-meta";
import { SupplyPartKey } from "./SupplyPartKey";

export interface SupplySplitBarProps {
  supply: AllPoolsSupply;
  nu7Active: boolean;
}

/**
 * The 21M cap as one bar, split by where each ZEC is. Widths are exact shares of the cap, so the
 * bar is the partition itself; the words beside it carry every figure, including slivers too
 * thin to see. With any part unread it is not drawn: a gap would still look like a whole.
 */
export function SupplySplitBar({ supply, nu7Active }: SupplySplitBarProps) {
  const segments = supplyBarSegments(supply);
  if (segments === null) {
    return (
      <p className="text-sm text-ink-dim">
        Split by pool <Unmeasured />: a part could not be read.
      </p>
    );
  }
  const drawn = segments.map((s) => ({ ...s, meta: supplyPartMeta(s.part, nu7Active) }));
  // SVG positions, not inline styles: each segment starts where the previous one ended.
  const starts = drawn.map((_, i) => drawn.slice(0, i).reduce((sum, s) => sum + s.pct, 0));
  const label = `21 million ZEC by pool: ${drawn
    .map((s) => `${s.meta.label} ${formatSharePct(s.pct)}`)
    .join(", ")}`;

  return (
    <div>
      <svg
        viewBox="0 0 100 6"
        preserveAspectRatio="none"
        className="h-5 w-full border border-edge-faint"
        role="img"
        aria-label={label}
      >
        {drawn.map((s, i) => (
          <rect
            key={s.part.key}
            x={starts[i]}
            width={s.pct}
            height="6"
            className={s.meta.ink}
            fill="currentColor"
          />
        ))}
      </svg>
      {/* The cards beside this give shares of what is issued; these are of the cap. */}
      <p className="microlabel mt-3">Share of 21M</p>
      <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-ink-dim">
        {drawn.map((s) => (
          <li key={s.part.key} className="inline-flex items-center gap-1.5">
            <SupplyPartKey ink={s.meta.ink} />
            {s.meta.label}
            <span className="text-ink-faint tabular-nums">{formatSharePct(s.pct)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
