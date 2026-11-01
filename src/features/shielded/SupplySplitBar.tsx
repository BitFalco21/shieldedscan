"use client";

import { useState, type PointerEvent } from "react";
import type { AllPoolsSupply } from "@/domain";
import { supplyBarSegments } from "@/domain";
import { formatSharePct, formatZecCompact } from "@/lib/format";
import { Unmeasured } from "@/components/Unmeasured";
import { supplyPartMeta } from "./supply-part-meta";
import { SupplyBarMarker } from "./SupplyBarMarker";
import { SupplyPartKey } from "./SupplyPartKey";

export interface SupplySplitBarProps {
  supply: AllPoolsSupply;
  nu7Active: boolean;
}

/**
 * Hover previews a part, for a mouse only: on touch a tap is the toggle, and a hover that sticks
 * after the tap would fight it.
 */
const isMouse = (event: PointerEvent) => event.pointerType === "mouse";

/**
 * The 21M cap as one bar, split by where each ZEC is. Widths are exact shares of the cap, so the
 * bar is the partition itself; the words beside it carry every figure, including slivers too
 * thin to see. With any part unread it is not drawn: a gap would still look like a whole.
 *
 * A legend entry highlights its segment (others dim, widths never change) and points at it, so
 * Sprout's tenth of a percent can be found. Not tied to the cards below: one card is always
 * selected and drives the panel, so linking them would dim the bar on load or move the panel
 * when a reader only wanted to find a sliver. The shared colour key already joins the two.
 */
export function SupplySplitBar({ supply, nu7Active }: SupplySplitBarProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
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

  const shownKey = hovered ?? selected;
  const shownIndex = drawn.findIndex((s) => s.part.key === shownKey);
  const shown = shownIndex === -1 ? null : drawn[shownIndex]!;
  // Compact, so the callout stays one line on a phone. `zat` is never null once the bar is drawn
  // (`supplyBarSegments` refuses a partial bar); the check is for the type, never a stand-in.
  const figure = (s: (typeof drawn)[number]) =>
    `${s.part.zat === null ? "" : `${formatZecCompact(s.part.zat)} · `}${formatSharePct(s.pct)} of 21M`;
  const chosen = drawn.find((s) => s.part.key === selected) ?? null;

  return (
    <div>
      <SupplyBarMarker
        segment={shown === null ? null : { start: starts[shownIndex]!, pct: shown.pct }}
        label={shown?.meta.label ?? ""}
        figure={shown === null ? "" : figure(shown)}
      />
      <svg
        viewBox="0 0 100 6"
        preserveAspectRatio="none"
        className="h-5 w-full border border-edge-faint"
        role="img"
        aria-label={label}
        onPointerLeave={() => setHovered(null)}
      >
        {drawn.map((s, i) => (
          <rect
            key={s.part.key}
            x={starts[i]}
            width={s.pct}
            height="6"
            className={`${s.meta.ink} transition-opacity ${
              shown !== null && shown.part.key !== s.part.key ? "opacity-25" : ""
            }`}
            fill="currentColor"
            onPointerEnter={(event) => {
              if (isMouse(event)) setHovered(s.part.key);
            }}
          />
        ))}
        {/* The outline is what finds a sliver: its stroke keeps its width when the bar scales,
            so a segment narrower than a pixel is still boxed. */}
        {shown === null ? null : (
          <rect
            x={starts[shownIndex]}
            width={shown.pct}
            height="6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
            className="pointer-events-none text-ink-bright"
          />
        )}
      </svg>
      {/* Only a click is announced; a hover passing over the bar would talk over the reader. */}
      <p className="sr-only" aria-live="polite">
        {chosen === null ? "" : `${chosen.meta.label}: ${figure(chosen)}`}
      </p>
      {/* The cards beside this give shares of what is issued; these are of the cap. */}
      <p className="microlabel mt-3">Share of 21M</p>
      <ul
        aria-label="Highlight a part of the bar"
        className="mt-1.5 flex flex-wrap gap-x-1 gap-y-1 text-xs text-ink-dim"
      >
        {drawn.map((s) => {
          const pressed = selected === s.part.key;
          return (
            <li key={s.part.key}>
              <button
                type="button"
                aria-pressed={pressed}
                onClick={() => setSelected(pressed ? null : s.part.key)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setSelected(null);
                }}
                onPointerEnter={(event) => {
                  if (isMouse(event)) setHovered(s.part.key);
                }}
                onPointerLeave={() => setHovered(null)}
                className={`inline-flex cursor-pointer items-center gap-1.5 rounded-sm border px-1.5 py-0.5 transition-colors ${
                  pressed ? "border-edge text-ink-bright" : "border-transparent hover:text-ink"
                }`}
              >
                <SupplyPartKey ink={s.meta.ink} />
                {s.meta.label}
                <span className="text-ink-faint tabular-nums">{formatSharePct(s.pct)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
