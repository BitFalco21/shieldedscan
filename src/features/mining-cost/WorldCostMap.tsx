"use client";

import { useRef } from "react";
import type { CountryCost } from "@/domain";
import { useSvgZoom } from "@/lib/use-svg-zoom";
import { costTier } from "@/domain";
import {
  WORLD_MAP_HEIGHT,
  WORLD_MAP_NAMES,
  WORLD_MAP_PATHS,
  WORLD_MAP_POINTS,
  WORLD_MAP_WIDTH,
} from "./world-map.generated";

export interface WorldCostMapProps {
  /** Every country with a tariff in the active band, keyed by ISO3. */
  costs: ReadonlyMap<string, CountryCost>;
  /** The country under the pointer or keyboard focus, or null. */
  onFocus: (iso3: string | null) => void;
}

const K_MAX = 12;

/**
 * The world, one SVG path per country, coloured by the electricity cost of one ZEC.
 *
 * Real geometry shipped inside the page: `world-map.generated.ts` is Natural Earth's 1:110m
 * coastlines projected with Equal Earth by `brand/world-map-derive.py`. No map library, tile
 * server or CDN, as the CSP requires. Microstates with no polygon at that scale are drawn as
 * dots so no row of the tariff table goes missing.
 *
 * Colour is a class per tier: `.cost-tier-1..5` derive from the accent hue in `globals.css`, so
 * the map follows the theme, and land with no published tariff is a fixed neutral.
 *
 * Zoom is a `transform` attribute on one `<g>`, not an inline style. Wheel and pinch zoom about
 * the pointer, drag pans, the buttons serve anyone without a wheel. No `transition`: easing a
 * 12x zoom would lag the hand.
 */
export function WorldCostMap({ costs, onFocus }: WorldCostMapProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  // Zoom, pan and pinch come from the shared hook, so the two maps share one pinch geometry.
  const { view, dragging, zoomAt, zoomCentre, reset, handlers } = useSvgZoom({
    svgRef,
    boxRef,
    width: WORLD_MAP_WIDTH,
    height: WORLD_MAP_HEIGHT,
    kMax: K_MAX,
  });

  const strokeWidth = 0.6 / view.k;
  const dotRadius = 4.5 / Math.sqrt(view.k);

  return (
    <div
      ref={boxRef}
      className={["cost-map", dragging ? "is-dragging" : ""].join(" ").trim()}
      onDoubleClick={(e) => zoomAt(2, e.clientX, e.clientY)}
      // A mouse press must not focus a country: the focus ring is drawn around the path's
      // bounding box. Preventing the default on mousedown stops only the focus; the drag starts
      // on pointerdown, and keyboard focus still lands and shows the ring. The buttons keep
      // their own focus.
      onMouseDown={(e) => {
        if (!(e.target as Element).closest("button")) e.preventDefault();
      }}
      onPointerDown={handlers.onPointerDown}
      onPointerMove={handlers.onPointerMove}
      onPointerUp={handlers.onPointerUp}
      onPointerCancel={handlers.onPointerCancel}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WORLD_MAP_WIDTH} ${WORLD_MAP_HEIGHT}`}
        role="img"
        aria-label="World map coloured by the electricity cost of mining one ZEC in each country"
      >
        <g transform={`translate(${view.tx} ${view.ty}) scale(${view.k})`}>
          {Object.entries(WORLD_MAP_PATHS).map(([iso3, d]) => {
            const cost = costs.get(iso3);
            const tier = cost ? costTier(cost.costUsd) : null;
            return (
              <path
                key={iso3}
                d={d}
                strokeWidth={strokeWidth}
                // An array join, never a template literal with a conditional fragment, which
                // loses the space and glues two class names into one.
                className={[
                  "cost-land",
                  tier === null ? "cost-tier-none" : `cost-tier-${tier}`,
                ].join(" ")}
                tabIndex={cost ? 0 : -1}
                aria-label={
                  cost
                    ? `${cost.name}: ${cost.costUsd.toFixed(0)} dollars of electricity per ZEC`
                    : `${WORLD_MAP_NAMES[iso3] ?? iso3}: no published tariff`
                }
                onPointerEnter={() => onFocus(cost ? iso3 : null)}
                onPointerLeave={() => onFocus(null)}
                onFocus={() => onFocus(cost ? iso3 : null)}
                onBlur={() => onFocus(null)}
              />
            );
          })}
          {Object.entries(WORLD_MAP_POINTS).map(([iso3, [x, y]]) => {
            const cost = costs.get(iso3);
            if (!cost) return null;
            return (
              <circle
                key={iso3}
                cx={x}
                cy={y}
                r={dotRadius}
                strokeWidth={strokeWidth * 1.3}
                className={`cost-land cost-dot cost-tier-${costTier(cost.costUsd)}`}
                tabIndex={0}
                aria-label={`${cost.name}: ${cost.costUsd.toFixed(0)} dollars of electricity per ZEC`}
                onPointerEnter={() => onFocus(iso3)}
                onPointerLeave={() => onFocus(null)}
                onFocus={() => onFocus(iso3)}
                onBlur={() => onFocus(null)}
              />
            );
          })}
        </g>
      </svg>
      <div className="cost-zoom" role="group" aria-label="Zoom">
        <button type="button" onClick={() => zoomCentre(1.6)} aria-label="Zoom in">
          +
        </button>
        <button type="button" onClick={() => zoomCentre(1 / 1.6)} aria-label="Zoom out">
          −
        </button>
        <button
          type="button"
          onClick={reset}
          aria-label="Reset the map view"
          disabled={view.k === 1}
        >
          ⟲
        </button>
      </div>
    </div>
  );
}
