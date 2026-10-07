"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useHydrated } from "@/lib/use-hydrated";
import type { EcosystemEntry } from "@/domain/ecosystem";
import { useWheelZoom, wheelFactor } from "@/lib/use-wheel-zoom";
import {
  HOME_2D,
  HOME_3D,
  dragPlane,
  focusOn,
  isFlat,
  orbit,
  pinchCamera,
  zoomAbout,
  type Camera,
} from "./camera";
import { NODE_R, type EcosystemLayout } from "./layout";
import { buildScene, findInScene, type View } from "./scene";
import { snapshotSvg } from "./snapshot";
import { StageCard } from "./StageCard";
import { StageScene } from "./StageScene";
import { StageSearch } from "./StageSearch";
import { StageToolbar } from "./StageToolbar";
import { useStageCamera } from "./use-stage-camera";

export interface EcosystemStageProps {
  layout: EcosystemLayout;
  entries: readonly EcosystemEntry[];
  logos: ReadonlySet<string>;
  updatedOn: string;
}

/** A drag starts only once the pointer has travelled this far, so a click stays a click. */
const DRAG_PX = 4;
/** Zoom a search result is brought to — close enough that its neighbours' names are legible. */
const FOCUS_ZOOM = 2.6;
/** In 3D no name renders smaller than this, in screen pixels; the collision rule makes room. */
const LABEL_FLOOR_PX = 11;

/** The flat view: the scene is the layout itself, and the camera only shifts and scales it. */
const FLAT_VIEW: View = { yaw: 0, pitch: 0, tx: 0, ty: 0 };

type Point = { x: number; y: number };

/** The two touching pointers of a pinch; callers check the map holds exactly two. */
function pointerPair(pointers: Map<number, Point>): [Point, Point] {
  return [...pointers.values()] as [Point, Point];
}

type Gesture =
  | { kind: "none" }
  | { kind: "pending" | "drag"; x: number; y: number; move: boolean }
  | {
      kind: "pinch";
      start: Camera;
      mid: { x: number; y: number };
      dist: number;
    };

/**
 * The ecosystem map as a stage a reader can move around, with the controls every 3D viewer
 * uses: in 2D a drag moves the map; in 3D a drag ORBITS the point in the middle of the screen
 * and a right- or shift-drag grabs the map's plane and slides it. Scroll or pinch zooms toward
 * the point under the pointer, on the plane itself, and a project picked from search is glided
 * to. Everything is SVG — a hundred-odd billboards re-sorted per frame are well within what the
 * DOM draws smoothly — and the server renders the same picture at the starting view, so with
 * scripting off the map is still there and every project is still a link.
 *
 * Nothing moves on its own. The only animations are glides the reader asked for (search,
 * reset, zoom buttons, 2D/3D), and under `prefers-reduced-motion` each one jumps instead.
 */
export function EcosystemStage({ layout, entries, logos, updatedOn }: EcosystemStageProps) {
  const halfW = layout.halfWidth;
  const halfH = layout.halfHeight;
  const [threeD, setThreeD] = useState(false);
  const { cam, camRef, setCam, glideTo, stopGlide } = useStageCamera();
  const [hovered, setHovered] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  // Controls exist only where they can work: false on the server, so the static markup has no
  // button that would do nothing without scripting.
  const mounted = useHydrated();
  const [unit, setUnit] = useState(1);

  const svgRef = useRef<SVGSVGElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture>({ kind: "none" });
  const suppressClick = useRef(false);

  /** Stage units per screen pixel, tracked so the hover card keeps one size at any width. */
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const r = svg.getBoundingClientRect();
      if (r.width > 0 && r.height > 0)
        setUnit(Math.max((2 * halfW) / r.width, (2 * halfH) / r.height));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(svg);
    return () => ro.disconnect();
  }, [halfW, halfH]);

  /** Client pixels → stage units (the viewBox is centred on the layout's origin). */
  const toStage = useCallback((cx: number, cy: number) => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM?.();
    if (!svg || !ctm) return null;
    const p = new DOMPoint(cx, cy).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y, perPx: 1 / ctm.a };
  }, []);

  // Flat, the scene never changes — the camera's shift and zoom are one transform around it, so
  // a 2D pan re-renders nothing. Tilted or turned, every frame is a new projection.
  const flat = isFlat(cam);
  const view = useMemo<View>(
    () => (flat ? FLAT_VIEW : { yaw: cam.yaw, pitch: cam.pitch, tx: cam.tx, ty: cam.ty }),
    [flat, cam.yaw, cam.pitch, cam.tx, cam.ty],
  );
  // Tilted, a name is never drawn below an 11px floor on screen: `unit` is stage units per
  // pixel, so the floor in world units shrinks as the reader zooms in.
  const minFont = flat ? 0 : (LABEL_FLOOR_PX * unit) / cam.zoom;
  const scene = useMemo(() => buildScene(layout, view, minFont), [layout, view, minFont]);
  const shiftX = flat ? cam.tx : 0;
  const shiftY = flat ? cam.ty : 0;

  useWheelZoom(stageRef, (e) => {
    const p = toStage(e.clientX, e.clientY);
    if (!p) return;
    stopGlide();
    const c = camRef.current;
    setCam(
      zoomAbout(c, c.zoom * wheelFactor(e.deltaY, e.deltaMode, e.ctrlKey), p.x, p.y, halfW, halfH),
    );
  });

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest("button, input, .eco-search")) return;
    stopGlide();
    suppressClick.current = false;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = pointerPair(pointers.current);
      const mid = toStage((a.x + b.x) / 2, (a.y + b.y) / 2);
      if (!mid) return;
      for (const id of pointers.current.keys()) e.currentTarget.setPointerCapture(id);
      gesture.current = {
        kind: "pinch",
        start: camRef.current,
        mid,
        dist: Math.hypot(a.x - b.x, a.y - b.y),
      };
      setDragging(true);
      return;
    }
    const swap = e.shiftKey || e.button !== 0;
    gesture.current = { kind: "pending", x: e.clientX, y: e.clientY, move: !threeD || swap };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const was = pointers.current.get(e.pointerId);
    if (!was) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (g.kind === "pinch" && pointers.current.size === 2) {
      const [a, b] = pointerPair(pointers.current);
      const mid = toStage((a.x + b.x) / 2, (a.y + b.y) / 2);
      if (!mid) return;
      setCam(
        pinchCamera(g.start, g.mid, g.dist, mid, Math.hypot(a.x - b.x, a.y - b.y), halfW, halfH),
      );
      return;
    }
    if (g.kind === "pending") {
      if (Math.hypot(e.clientX - g.x, e.clientY - g.y) < DRAG_PX) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      gesture.current = { ...g, kind: "drag" };
      setDragging(true);
      setHovered(null);
    }
    const d = gesture.current;
    if (d.kind !== "drag") return;
    const from = toStage(was.x, was.y);
    const to = toStage(e.clientX, e.clientY);
    if (!from || !to) return;
    const c = camRef.current;
    setCam(d.move ? dragPlane(c, from, to, halfW, halfH) : orbit(c, to.x - from.x, to.y - from.y));
  };

  const onPointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.delete(e.pointerId)) return;
    const g = gesture.current;
    if (g.kind === "drag" || g.kind === "pinch") suppressClick.current = true;
    if (pointers.current.size === 0) {
      gesture.current = { kind: "none" };
      setDragging(false);
    } else if (g.kind === "pinch") {
      // One finger lifted: stop, rather than jump into a one-finger drag from a stale origin.
      gesture.current = { kind: "none" };
    }
  };

  /** A drag that ends over a project must not also open it. */
  const onClickCapture = (e: ReactMouseEvent) => {
    if (!suppressClick.current) return;
    suppressClick.current = false;
    e.preventDefault();
    e.stopPropagation();
  };

  const nodeIdAt = (target: EventTarget | null) =>
    (target as Element | null)?.closest?.("[data-eco-id]")?.getAttribute("data-eco-id") ?? null;

  const home = threeD ? HOME_3D : HOME_2D;

  const pick = useCallback(
    (id: string) => {
      setSearching(false);
      setPicked(id);
      setHovered(null);
      const hit = layout.nodes.find((n) => n.entry.id === id);
      if (!hit) return;
      const c = camRef.current;
      glideTo(focusOn(c, hit.x, hit.y, Math.max(c.zoom, FOCUS_ZOOM)));
    },
    [layout, camRef, glideTo],
  );

  const reset = useCallback(() => {
    setPicked(null);
    setSearching(false);
    glideTo(home);
  }, [glideTo, home]);

  const setMode = (d: boolean) => {
    if (d === threeD) return;
    setThreeD(d);
    setPicked(null);
    glideTo(d ? HOME_3D : HOME_2D);
  };

  const zoomBy = (factor: number) => {
    const c = camRef.current;
    glideTo(zoomAbout(c, c.zoom * factor, 0, 0, halfW, halfH));
  };

  const snapshot = async () => {
    const svg = svgRef.current;
    if (!svg || busy) return;
    setBusy(true);
    setStatus("Saving snapshot…");
    try {
      await snapshotSvg(svg, {
        fileName: `zcash-ecosystem-${updatedOn}.png`,
        footer: `shieldedscan.xyz/ecosystem · ${entries.length} projects · last updated on ${updatedOn}`,
        exclude: ".eco-card",
      });
      setStatus("Snapshot saved.");
    } catch {
      setStatus("The snapshot could not be made in this browser.");
    } finally {
      setBusy(false);
    }
  };

  /** `/` opens search, Escape closes it and lets go of a picked project. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as Element | null)?.closest?.("input, textarea, [contenteditable]");
      if (e.key === "/" && !typing && stageRef.current?.checkVisibility?.() !== false) {
        e.preventDefault();
        setSearching(true);
      } else if (e.key === "Escape" && !typing) {
        setPicked(null);
        setSearching(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const cardId = hovered ?? picked;
  const cardNode = cardId ? findInScene(scene, cardId) : null;
  const cardTop = cardNode
    ? {
        x: (cardNode.x - shiftX) * cam.zoom,
        y: (cardNode.y - NODE_R * cardNode.scale - shiftY) * cam.zoom,
      }
    : null;

  return (
    <div>
      <div
        ref={stageRef}
        className={`eco-stage relative overflow-hidden rounded-md border border-edge-faint ${
          dragging ? "is-dragging" : ""
        }`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onClickCapture={onClickCapture}
        onContextMenu={(e) => {
          if (!(e.target as Element).closest("a")) e.preventDefault();
        }}
        onPointerOver={(e) => {
          if (gesture.current.kind === "none") setHovered(nodeIdAt(e.target));
        }}
        onPointerLeave={() => setHovered(null)}
        onFocus={(e) => setHovered(nodeIdAt(e.target))}
        onBlur={() => setHovered(null)}
      >
        <svg
          ref={svgRef}
          viewBox={`${-halfW} ${-halfH} ${2 * halfW} ${2 * halfH}`}
          className="eco-map h-full w-full"
          role="group"
          aria-label={`Map of ${entries.length} Zcash ecosystem projects in ${layout.sectors.length} categories. Each project links to its own site.`}
          onClick={(e) => {
            if (e.target === e.currentTarget) setPicked(null);
          }}
        >
          <g
            transform={`scale(${cam.zoom.toFixed(4)}) translate(${(-shiftX).toFixed(2)} ${(-shiftY).toFixed(2)})`}
          >
            <StageScene scene={scene} logos={logos} highlightId={picked} hoveredId={hovered} />
          </g>
          {cardNode && cardTop ? (
            <StageCard
              entry={cardNode.node.entry}
              slot={cardNode.node.slot}
              x={cardTop.x}
              y={cardTop.y}
              unit={unit}
              halfW={halfW}
              halfH={halfH}
            />
          ) : null}
        </svg>

        {mounted ? (
          <>
            <div className="absolute top-3 right-3">
              <StageToolbar
                threeD={threeD}
                onMode={setMode}
                onZoom={zoomBy}
                onSearch={() => setSearching((s) => !s)}
                onReset={reset}
                onSnapshot={snapshot}
                snapshotBusy={busy}
              />
            </div>
            {searching ? (
              <div className="absolute top-4 left-1/2 w-[min(34rem,calc(100%-6rem))] -translate-x-1/2">
                <StageSearch
                  entries={entries}
                  logos={logos}
                  onPick={pick}
                  onClose={() => setSearching(false)}
                />
              </div>
            ) : null}
          </>
        ) : null}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-6 gap-y-1 text-xs text-ink-faint">
        <p>
          {threeD
            ? "Drag to orbit · right- or shift-drag to move · scroll or pinch to zoom"
            : "Drag to move · scroll or pinch to zoom"}{" "}
          · click a project to open its site
        </p>
        <p aria-live="polite">{status}</p>
      </div>
    </div>
  );
}
