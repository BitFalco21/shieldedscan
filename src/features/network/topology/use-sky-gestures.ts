"use client";

import {
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent,
  type RefObject,
  type SetStateAction,
} from "react";
import { useWheelZoom, wheelFactor } from "@/lib/use-wheel-zoom";
import {
  dragMode,
  panBy,
  pinchCamera,
  turnedFrom,
  zoomAbout,
  type DragMode,
  type SkyCamera,
} from "./sky-camera";

interface Point {
  x: number;
  y: number;
}

type Gesture =
  | { kind: "drag"; mode: DragMode; x: number; y: number; cam: SkyCamera }
  | { kind: "pinch"; mid: Point; dist: number; cam: SkyCamera }
  | null;

export interface SkyGestureOptions {
  /** The element that receives the pointer and wheel events. */
  boxRef: RefObject<HTMLDivElement | null>;
  /** The canvas, whose box turns client coordinates into canvas-local pixels. */
  canvasRef: RefObject<HTMLCanvasElement | null>;
  cam: SkyCamera;
  setCam: Dispatch<SetStateAction<SkyCamera>>;
  /** A pointer moving with no gesture under way, in canvas-local pixels. */
  onHover: (x: number, y: number) => void;
  /** A click that did not move, in canvas-local pixels. */
  onTap: (x: number, y: number) => void;
}

export interface SkyGestures {
  /** A pointer is down: the stage shows a grabbing cursor. */
  dragging: boolean;
  /** Spread onto the element `boxRef` points at. */
  handlers: {
    onPointerDown: (e: PointerEvent<HTMLDivElement>) => void;
    onPointerMove: (e: PointerEvent<HTMLDivElement>) => void;
    onPointerUp: (e: PointerEvent<HTMLDivElement>) => void;
    onPointerCancel: (e: PointerEvent<HTMLDivElement>) => void;
    onClick: (e: { clientX: number; clientY: number }) => void;
  };
}

const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Every way a reader moves the sky's camera: the wheel and a trackpad pinch zoom about the
 * cursor, one pointer turns or moves the view (`dragMode`), two fingers pinch-zoom and move
 * together, and lifting one finger of a pinch hands over to a drag from the other. Each gesture
 * is computed from the camera it started with, so the result depends on where the pointers are,
 * never on how many events arrived. The camera math lives in `sky-camera.ts`; picking stays with
 * the caller.
 */
export function useSkyGestures({
  boxRef,
  canvasRef,
  cam,
  setCam,
  onHover,
  onTap,
}: SkyGestureOptions): SkyGestures {
  const [dragging, setDragging] = useState(false);
  // Pointers currently down, in canvas-local px: one drives a turn or a move, two a pinch.
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture>(null);
  // A gesture that moved must not also count as a click that pins a hub.
  const moved = useRef(false);

  // A native, non-passive listener: React's onWheel cannot cancel the page zoom (see the hook).
  useWheelZoom(boxRef, (e) => {
    const r = canvasRef.current?.getBoundingClientRect();
    if (!r || r.width === 0) return;
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    const w = r.width;
    setCam((c) => zoomAbout(c, c.zoom * wheelFactor(e.deltaY, e.deltaMode, e.ctrlKey), px, py, w));
  });

  const localPoint = useCallback(
    (e: { clientX: number; clientY: number }): [number, number] => {
      const r = canvasRef.current?.getBoundingClientRect();
      if (!r) return [0, 0];
      return [e.clientX - r.left, e.clientY - r.top];
    },
    [canvasRef],
  );

  /** A finger lifted from a pinch hands over to a one-finger drag from where the other one is. */
  const endPointer = (id: number) => {
    pointers.current.delete(id);
    const rest = [...pointers.current.values()];
    if (rest.length === 1) {
      gesture.current = { kind: "drag", mode: dragMode(cam.zoom, false), ...rest[0]!, cam };
    } else if (rest.length === 0) {
      gesture.current = null;
      setDragging(false);
    }
  };

  return {
    dragging,
    handlers: {
      onPointerDown: (e) => {
        const [x, y] = localPoint(e);
        pointers.current.set(e.pointerId, { x, y });
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
        const pts = [...pointers.current.values()];
        if (pts.length === 1) {
          moved.current = false;
          gesture.current = {
            kind: "drag",
            mode: dragMode(cam.zoom, e.shiftKey || e.button !== 0),
            x,
            y,
            cam,
          };
        } else if (pts.length === 2) {
          moved.current = true;
          const [a, b] = pts as [Point, Point];
          gesture.current = { kind: "pinch", mid: midpoint(a, b), dist: distance(a, b), cam };
        }
      },
      onPointerMove: (e) => {
        const [x, y] = localPoint(e);
        if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x, y });
        const g = gesture.current;
        const w = canvasRef.current?.getBoundingClientRect().width ?? 0;
        if (g?.kind === "pinch" && pointers.current.size >= 2) {
          const [a, b] = [...pointers.current.values()] as [Point, Point];
          setCam(pinchCamera(g.cam, g.mid, g.dist, midpoint(a, b), distance(a, b), w));
          return;
        }
        if (g?.kind === "drag") {
          const dx = x - g.x;
          const dy = y - g.y;
          if (Math.hypot(dx, dy) > 2) moved.current = true;
          setCam((c) =>
            g.mode === "turn"
              ? { ...c, ...turnedFrom(g.cam, dx, dy) }
              : panBy({ ...c, panX: g.cam.panX, panY: g.cam.panY }, dx, dy, w),
          );
          return;
        }
        onHover(x, y);
      },
      onPointerUp: (e) => endPointer(e.pointerId),
      onPointerCancel: (e) => endPointer(e.pointerId),
      onClick: (e) => {
        if (moved.current) return;
        const [x, y] = localPoint(e);
        onTap(x, y);
      },
    },
  };
}
