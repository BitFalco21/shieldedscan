"use client";

import {
  useCallback,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { useWheelZoom } from "./use-wheel-zoom";

export interface SvgZoomView {
  /** Scale factor, 1 = the whole viewBox fits. */
  k: number;
  tx: number;
  ty: number;
}

export interface UseSvgZoomOptions {
  /** The `<svg>` whose viewBox is `0 0 width height`; client pixels are mapped through its box. */
  svgRef: RefObject<SVGSVGElement | null>;
  /** The element that receives wheel, drag and pinch — usually the svg's wrapper. */
  boxRef: RefObject<HTMLElement | null>;
  width: number;
  height: number;
  /** The largest scale a reader can reach. */
  kMax: number;
}

export interface SvgZoom {
  view: SvgZoomView;
  /** True while at least one pointer is captured — the caller usually sets a drag cursor. */
  dragging: boolean;
  /** Whether the pointer travelled more than a couple of pixels since it went down: a drag, not a click. */
  moved: RefObject<boolean>;
  /** Client pixels → SVG user units. */
  toSvg: (cx: number, cy: number) => [number, number];
  /** Zoom by `factor` about a client point. */
  zoomAt: (factor: number, cx: number, cy: number) => void;
  /** Zoom by `factor` about the svg's centre — the buttons for anyone without a wheel. */
  zoomCentre: (factor: number) => void;
  reset: () => void;
  /** The four pointer handlers for `boxRef`'s element. `onPointerMove` returns false when the
   *  pointer is not captured, so a caller can use that motion for hover picking instead. */
  handlers: {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => boolean;
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
  };
}

const IDENTITY: SvgZoomView = { k: 1, tx: 0, ty: 0 };

/**
 * Zoom, pan and pinch for an SVG drawn to a fixed viewBox, as a `transform` on one `<g>`.
 * Shared by the maps so pinch geometry and clamping have one implementation.
 *
 * The view is a `transform` attribute, never a style. A press on a `<button>` inside the box
 * is left alone, because capturing it would redirect the pointerup and the button would never
 * see its click. The wheel goes through `useWheelZoom`, since React's `onWheel` cannot cancel
 * the browser's page zoom. Nothing animates; the frame follows the hand.
 */
export function useSvgZoom({ svgRef, boxRef, width, height, kMax }: UseSvgZoomOptions): SvgZoom {
  const [view, setView] = useState<SvgZoomView>(IDENTITY);
  const [dragging, setDragging] = useState(false);
  const pointers = useRef(new Map<number, [number, number]>());
  const last = useRef<[number, number] | null>(null);
  const pinch = useRef<number | null>(null);
  const moved = useRef(false);

  const clamp = useCallback(
    (k: number, tx: number, ty: number): SvgZoomView => {
      const kk = Math.min(kMax, Math.max(1, k));
      return {
        k: kk,
        tx: Math.min(0, Math.max(width - width * kk, tx)),
        ty: Math.min(0, Math.max(height - height * kk, ty)),
      };
    },
    [kMax, width, height],
  );

  const toSvg = useCallback(
    (cx: number, cy: number): [number, number] => {
      const r = svgRef.current?.getBoundingClientRect();
      if (!r || r.width === 0) return [0, 0];
      return [((cx - r.left) / r.width) * width, ((cy - r.top) / r.height) * height];
    },
    [svgRef, width, height],
  );

  const zoomAt = useCallback(
    (factor: number, cx: number, cy: number) => {
      const [sx, sy] = toSvg(cx, cy);
      setView((v) => {
        const nk = Math.min(kMax, Math.max(1, v.k * factor));
        const r = nk / v.k;
        return clamp(nk, sx - (sx - v.tx) * r, sy - (sy - v.ty) * r);
      });
    },
    [clamp, toSvg, kMax],
  );

  const zoomCentre = useCallback(
    (factor: number) => {
      const r = svgRef.current?.getBoundingClientRect();
      if (!r) return;
      zoomAt(factor, r.left + r.width / 2, r.top + r.height / 2);
    },
    [svgRef, zoomAt],
  );

  const reset = useCallback(() => setView(IDENTITY), []);

  useWheelZoom(boxRef, (e) => zoomAt(e.deltaY < 0 ? 1.25 : 0.8, e.clientX, e.clientY));

  const release = (e: ReactPointerEvent<HTMLElement>) => {
    pointers.current.delete(e.pointerId);
    pinch.current = null;
    if (pointers.current.size === 0) setDragging(false);
  };

  const handlers: SvgZoom["handlers"] = {
    onPointerDown: (e) => {
      if ((e.target as Element).closest("button")) return;
      pointers.current.set(e.pointerId, [e.clientX, e.clientY]);
      e.currentTarget.setPointerCapture(e.pointerId);
      last.current = [e.clientX, e.clientY];
      moved.current = false;
      setDragging(true);
    },
    onPointerMove: (e) => {
      if (!pointers.current.has(e.pointerId)) return false;
      pointers.current.set(e.pointerId, [e.clientX, e.clientY]);
      if (pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()] as [[number, number], [number, number]];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (pinch.current !== null) zoomAt(d / pinch.current, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
        pinch.current = d;
        return true;
      }
      const r = svgRef.current?.getBoundingClientRect();
      const prev = last.current;
      if (!r || !prev) return true;
      const dx = ((e.clientX - prev[0]) / r.width) * width;
      const dy = ((e.clientY - prev[1]) / r.height) * height;
      if (Math.hypot(e.clientX - prev[0], e.clientY - prev[1]) > 2) moved.current = true;
      last.current = [e.clientX, e.clientY];
      setView((v) => clamp(v.k, v.tx + dx, v.ty + dy));
      return true;
    },
    onPointerUp: release,
    onPointerCancel: release,
  };

  return { view, dragging, moved, toSvg, zoomAt, zoomCentre, reset, handlers };
}
