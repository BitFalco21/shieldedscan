"use client";

import { useState } from "react";
import { formatCount, formatSharePct } from "@/lib/format";
import { MinersLegend } from "./MinersLegend";
import type { ShareSegment } from "./miners-view";

export interface PoolShareBarProps {
  segments: ShareSegment[];
  /** Every block in the window: the bar's whole width, and every share's denominator. */
  total: number;
}

/**
 * The window's blocks as one contiguous bar, each pool's segment in its own colour. Contiguous
 * because the segments add up to the window: a budget, not a set of bars. Pointing at a segment
 * or its legend item, or focusing the item, brings that segment forward.
 */
export function PoolShareBar({ segments, total }: PoolShareBarProps) {
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const pct = (blocks: number) => (total === 0 ? 0 : (100 * blocks) / total);
  const placed = segments.map((s, i) => ({
    ...s,
    x: pct(segments.slice(0, i).reduce((sum, p) => sum + p.blocks, 0)),
    width: pct(s.blocks),
  }));
  return (
    <div>
      <svg
        viewBox="0 0 100 6"
        preserveAspectRatio="none"
        className="h-6 w-full"
        role="img"
        aria-label={`Share of ${formatCount(total)} blocks by mining pool`}
        onPointerLeave={() => setHighlighted(null)}
      >
        {placed.map((s) => (
          <rect
            key={s.key}
            data-segment-key={s.key}
            x={s.x}
            y={0}
            width={Math.max(0, s.width - 0.15)}
            height={6}
            fill="currentColor"
            onPointerEnter={() => setHighlighted(s.key)}
            className={`${s.className} transition-opacity motion-reduce:transition-none ${
              highlighted !== null && highlighted !== s.key ? "opacity-25" : ""
            }`}
          />
        ))}
      </svg>
      <MinersLegend
        items={segments.map((s) => ({
          key: s.key,
          label: s.label,
          className: s.className,
          value: `${formatSharePct(pct(s.blocks))} (${formatCount(s.blocks)})`,
        }))}
        highlighted={highlighted}
        onHighlight={setHighlighted}
      />
    </div>
  );
}
