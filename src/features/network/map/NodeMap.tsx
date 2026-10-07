"use client";

import { useCallback, useRef } from "react";
import type { NetMap, NetMapCell } from "@/domain";
import { useSvgZoom } from "@/lib/use-svg-zoom";
import { LAND_DOTS_D } from "../land-dots.generated";
import { MAP_HEIGHT, MAP_WIDTH, projectLonLat } from "../map-projection";
import { CellMark } from "./CellMark";
import {
  cellClasses,
  cellClient,
  cellPlace,
  cellSize,
  ghostSize,
  markSize,
  type AsnTotal,
  type MapLens,
} from "./lenses";

export interface NodeMapProps {
  map: NetMap;
  lens: MapLens;
  ranking: AsnTotal[];
  showGhosts: boolean;
  /** The cell under the pointer or keyboard focus, and whether a click pinned it. */
  focused: NetMapCell | null;
  onFocus: (cell: NetMapCell | null) => void;
  onPin: (cell: NetMapCell) => void;
}

const K_MAX = 8;
/** Place names appear once the map is zoomed enough for them to be read, not guessed. */
const LABEL_FROM_K = 2.2;

/**
 * The world as a dot matrix, with one lit square per 1° cell of answering nodes and a hollow one
 * per cell of addresses that never answered.
 *
 * Real geometry shipped inside the page: the land is one `<path>` of 9,819 dots that
 * `brand/world-map-derive.py` sampled at build time from Natural Earth polygons, projected with
 * Equal Earth by the same constants `map-projection.ts` holds and is tested against. No map
 * library, no tiles, no CDN.
 *
 * Colour is a class per lens family, never an attribute or a style: every cell carries a class
 * from each family and the `<svg>`'s `data-lens` picks which paints, so switching lens is one
 * attribute change. Under the software lens the cell is its client's mark (`CellMark`) over a
 * transparent rect that keeps focus and picking. Zoom is a `transform` attribute on one `<g>`;
 * the readout is a fixed panel rather than a pointer-following tooltip.
 *
 * A cell is a 1° square (~110 km at the equator), never an address; a node GeoIP could not place
 * is counted by the readout and drawn nowhere.
 */
export function NodeMap({ map, lens, ranking, showGhosts, focused, onFocus, onPin }: NodeMapProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  // Zoom, pan, pinch, drag and the non-passive wheel all live in the hook (shared with the
  // tariff map); what stays here is the picking, which the hook leaves to the caller.
  const { view, dragging, moved, toSvg, zoomAt, zoomCentre, reset, handlers } = useSvgZoom({
    svgRef,
    boxRef,
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    kMax: K_MAX,
  });

  const k = view.k;
  /** The lit cell nearest a client point, within a thumb's reach, or null. */
  const nearestCell = useCallback(
    (cx: number, cy: number): NetMapCell | null => {
      const [sx, sy] = toSvg(cx, cy);
      const mx = (sx - view.tx) / view.k;
      const my = (sy - view.ty) / view.k;
      let best: NetMapCell | null = null;
      let bd = 14 / view.k;
      for (const c of map.cells) {
        const [x, y] = projectLonLat(c.lon, c.lat);
        const d = Math.hypot(mx - x, my - y);
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      return best;
    },
    [map.cells, toSvg, view],
  );
  const cells = map.cells.map((c) => {
    const [x, y] = projectLonLat(c.lon, c.lat);
    return { cell: c, x, y, z: cellSize(c.nodes) };
  });
  const ghosts = map.ghostCells.map((g) => {
    const [x, y] = projectLonLat(g.lon, g.lat);
    return { x, y, z: ghostSize(g.count), count: g.count };
  });

  return (
    <div
      ref={boxRef}
      className={["net-map", dragging ? "is-dragging" : ""].join(" ").trim()}
      data-lens={lens}
      onDoubleClick={(e) => zoomAt(2, e.clientX, e.clientY)}
      // A mouse press must not focus a cell: the focus ring would be a rectangle over whatever
      // was clicked or dragged. Keyboard focus still lands and fills the readout; the zoom
      // buttons keep their own focus.
      onMouseDown={(e) => {
        if (!(e.target as Element).closest("button")) e.preventDefault();
      }}
      onPointerDown={handlers.onPointerDown}
      onPointerMove={(e) => {
        if (handlers.onPointerMove(e)) return;
        // Not dragging: pick the nearest lit cell. Adjacent 1° cells overlap at any zoom
        // where they are legible, so per-rect hover would leave the covered ones
        // unreachable — nearest-point picking is what the reader's pointer means.
        if (!(e.target as Element).closest("button")) onFocus(nearestCell(e.clientX, e.clientY));
      }}
      onPointerUp={handlers.onPointerUp}
      onPointerCancel={handlers.onPointerCancel}
      onPointerLeave={() => onFocus(null)}
      onClick={(e) => {
        if (moved.current || (e.target as Element).closest("button")) return;
        const hit = nearestCell(e.clientX, e.clientY);
        if (hit) onPin(hit);
      }}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
        role="img"
        aria-label={`World map of answering Zcash nodes: ${map.cells.length} lit cells of one degree, coloured by ${lens === "client" ? "software" : lens === "asn" ? "hosting network" : "share of our crawls answered"}`}
      >
        <g transform={`translate(${view.tx} ${view.ty}) scale(${k})`}>
          <path className="net-land" d={LAND_DOTS_D} strokeWidth={1.5 / Math.sqrt(k)} />
          {showGhosts
            ? ghosts.map((g, i) => (
                <rect
                  key={i}
                  className="net-ghost"
                  x={g.x - g.z / 2}
                  y={g.y - g.z / 2}
                  width={g.z}
                  height={g.z}
                  strokeWidth={0.7 / k}
                  data-count={g.count}
                />
              ))
            : null}
          {cells.map(({ cell, x, y, z }) => {
            const on = focused === cell;
            return (
              <rect
                key={`${cell.lat}:${cell.lon}`}
                className={`net-cell ${cellClasses(cell, ranking)}`}
                x={x - z / 2}
                y={y - z / 2}
                width={z}
                height={z}
                opacity={on ? 1 : 0.92}
                tabIndex={0}
                role="button"
                aria-label={`${cellPlace(cell)}: ${cell.nodes} ${cell.nodes === 1 ? "node" : "nodes"}`}
                onFocus={() => onFocus(cell)}
                onBlur={() => onFocus(null)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onPin(cell);
                  }
                }}
              />
            );
          })}
          {cells.map(({ cell, x, y }) => (
            <CellMark
              key={`mark-${cell.lat}:${cell.lon}`}
              client={cellClient(cell)}
              x={x}
              y={y}
              z={markSize(cell.nodes)}
            />
          ))}
          {cells
            .filter(({ cell }) => focused === cell)
            .map(({ cell, x, y, z }) => (
              <rect
                key={`ring-${cell.lat}:${cell.lon}`}
                className="net-cell-ring"
                x={x - z / 2 - 3 / k}
                y={y - z / 2 - 3 / k}
                width={z + 6 / k}
                height={z + 6 / k}
                strokeWidth={1 / k}
              />
            ))}
          {k >= LABEL_FROM_K
            ? cells
                .filter(({ cell }) => cell.city !== null)
                .map(({ cell, x, y, z }) => (
                  <text
                    key={`label-${cell.lat}:${cell.lon}`}
                    className="net-cell-label"
                    x={x + z / 2 + 4 / k}
                    y={y + 4 / k}
                    fontSize={11 / k}
                  >
                    {cell.city} · {cell.nodes}
                  </text>
                ))
            : null}
        </g>
      </svg>
      <div className="net-map-note">
        one cell ≈ 110 km · GeoIP places a node; it does not measure it
      </div>
      <div className="net-zoom" role="group" aria-label="Zoom">
        <button type="button" onClick={() => zoomCentre(1.5)} aria-label="Zoom in">
          +
        </button>
        <button type="button" onClick={() => zoomCentre(1 / 1.5)} aria-label="Zoom out">
          −
        </button>
        <button type="button" onClick={reset} aria-label="Reset the map view" disabled={k === 1}>
          ⟲
        </button>
      </div>
    </div>
  );
}
