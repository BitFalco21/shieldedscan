"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NetTopology } from "@/domain";
import { ClientMark } from "@/components/ClientMark";
import { ZAKURA_CORE_D, ZAKURA_PETAL_D } from "@/components/ZakuraMark";
import { ZCASHD_BADGE_DATA_URI } from "@/components/zcashd-badge.generated";
import { ZEBRA_BADGE_DATA_URI } from "@/components/zebra-badge.generated";
import { layoutSky } from "./sky-layout";
import {
  NO_MARKS,
  drawSky,
  pickSky,
  type SkyFocus,
  type SkyFrame,
  type SkyMarks,
} from "./sky-draw";
import { DEFAULT_CAMERA, PAN_ZOOM, type SkyCamera } from "./sky-camera";
import { useSkyGestures } from "./use-sky-gestures";
import { readSkyPalette } from "./sky-palette";
import { TopologyReadout } from "./TopologyReadout";
import { formatCount } from "@/lib/format";

export interface SkyCanvasProps {
  /** The hubs-only graph, server-rendered; the never-answered population arrives after mount. */
  hubs: NetTopology;
}

/**
 * The sky: the whole known network in three dimensions, on the codebase's one canvas.
 *
 * A canvas rather than SVG because of what it draws: thousands of addresses hanging off the hubs
 * by tens of thousands of lines, redrawn on every drag frame — an element count and a redraw rate
 * SVG cannot carry. The four conditions the design system attaches to that exception are all met here:
 *
 * - It is a mount-only enhancement over a server-rendered readout. The counts and the
 *   most-advertised list are HTML, rendered with the hubs on the server; the canvas fills in
 *   after mount, and the ghosts are fetched then from `/api/network/topology`, so the tab's
 *   own HTML stays small and a reader without JavaScript still gets the facts.
 * - Its colours are read from the CSS tokens (`readSkyPalette`) and re-read when the theme
 *   attribute changes, so the hue themes apply to it as to everything else.
 * - It carries `role="img"` and an `aria-label` that states what it shows; keyboard readers
 *   reach every hub through the readout's buttons, which pin it.
 * - Nothing animates on its own. The layout settles once, deterministically; the picture
 *   moves only under a hand.
 *
 * Every line means "told us about". Nothing here is a connection.
 */
export function SkyCanvas({ hubs }: SkyCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [sky, setSky] = useState<NetTopology | null>(null);
  const [skyFailed, setSkyFailed] = useState(false);
  const [cam, setCam] = useState<SkyCamera>(DEFAULT_CAMERA);
  const [hover, setHover] = useState<SkyFocus>(null);
  const [pinned, setPinned] = useState<SkyFocus>(null);
  // Bumped by whatever changes the picture without changing the data: a theme switch, a
  // resize, the badge image finishing its decode. The draw effect depends on it.
  const [redraws, setRedraws] = useState(0);
  const bump = useCallback(() => setRedraws((n) => n + 1), []);
  const frame = useRef<SkyFrame | null>(null);
  const marks = useRef<SkyMarks | null>(null);
  const { dragging, handlers } = useSkyGestures({
    boxRef,
    canvasRef,
    cam,
    setCam,
    onHover: (x, y) => {
      if (!frame.current) return;
      const hit = pickSky(frame.current, x, y);
      setHover((prev) => (prev?.kind === hit?.kind && prev?.index === hit?.index ? prev : hit));
    },
    onTap: (x, y) => {
      if (!frame.current) return;
      const hit = pickSky(frame.current, x, y);
      setPinned((p) => (hit && p?.kind === hit.kind && p.index === hit.index ? null : hit));
    },
  });

  const topology = sky ?? hubs;
  // Nothing is drawn until the full sky has arrived (or failed, in which case the hubs alone are
  // drawn). The server's hub list can be older than the fetched one, and the not-answering
  // addresses change the whole look, so drawing the hubs first would show a different picture
  // and then jump.
  const ready = sky !== null || skyFailed;
  const layout = useMemo(() => (ready ? layoutSky(topology) : null), [ready, topology]);
  const focus = pinned ?? hover;

  // The never-answered population, fetched after mount through a first-party route handler:
  // the bearer token never reaches the browser, and the tab's HTML stays small.
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/network/topology", { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const body: unknown = await res.json();
        // The same structural check the stats page makes of its poll: the adapter behind the
        // route has already held the payload to the full guard and to the no-address sweep.
        if (
          typeof body !== "object" ||
          body === null ||
          (body as NetTopology).scope !== "all" ||
          !Array.isArray((body as NetTopology).hubs) ||
          !Array.isArray((body as NetTopology).ghosts)
        ) {
          throw new Error("unrecognised shape");
        }
        setSky(body as NetTopology);
      })
      .catch(() => {
        if (!controller.signal.aborted) setSkyFailed(true);
      });
    return () => controller.abort();
  }, []);

  // Escape releases a pin. Listened for on the window rather than the wrapper: pinning from the
  // readout's list unmounts the button that had focus, so the key lands on <body> and would
  // never reach a handler on the wrapper.
  useEffect(() => {
    if (pinned === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPinned(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pinned]);

  // A theme change or a resize redraws; neither changes the data.
  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(bump);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    const box = boxRef.current;
    const ro = typeof ResizeObserver === "undefined" || !box ? null : new ResizeObserver(bump);
    ro?.observe(box!);
    return () => {
      observer.disconnect();
      ro?.disconnect();
    };
  }, [bump]);

  // The marks are prepared on mount, not on the first draw, so the logos have decoded by the time
  // the sky arrives instead of popping in a frame after it.
  useEffect(() => {
    if (marks.current !== null || typeof Path2D === "undefined") return;
    const prepared: SkyMarks = {
      zakuraPetal: new Path2D(ZAKURA_PETAL_D),
      zakuraCore: new Path2D(ZAKURA_CORE_D),
      zcashd: null,
      zebra: null,
    };
    marks.current = prepared;
    // The two raster badges decode independently; each redraws once it lands.
    const zebra = new Image();
    zebra.onload = () => {
      marks.current = { ...marks.current!, zebra };
      bump();
    };
    zebra.src = ZEBRA_BADGE_DATA_URI;
    const zcashd = new Image();
    zcashd.onload = () => {
      marks.current = { ...marks.current!, zcashd };
      bump();
    };
    zcashd.src = ZCASHD_BADGE_DATA_URI;
  }, [bump]);

  // Draw whenever anything it depends on changes — and only then. The palette is read from the
  // tokens on every draw, so a theme switch repaints in the new hue; the marks are prepared
  // once, where Path2D and Image exist, and the badge redraws once its decode lands.
  useEffect(() => {
    const canvas = canvasRef.current;
    const box = boxRef.current;
    if (!canvas || !box) return;
    const size = Math.round(box.getBoundingClientRect().width);
    if (size === 0) return;
    if (layout === null) {
      frame.current = null;
      return;
    }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const palette = readSkyPalette(document.documentElement);
    frame.current = drawSky(
      ctx,
      size,
      topology,
      layout,
      cam,
      focus,
      palette,
      marks.current ?? NO_MARKS,
    );
  }, [topology, layout, cam, focus, redraws]);

  const clients = useMemo(() => {
    const counts = new Map<string, number>();
    for (const h of topology.hubs) counts.set(h.client, (counts.get(h.client) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [topology]);
  const ghostsDrawn = sky?.ghosts?.length ?? 0;
  const ghostsTotal = sky?.ghostsTotal ?? null;

  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0">
        <div
          ref={boxRef}
          className={["net-sky", dragging ? "is-dragging" : ""].join(" ").trim()}
          onContextMenu={(e) => e.preventDefault()}
          {...handlers}
          onPointerLeave={() => setHover(null)}
        >
          <canvas
            ref={canvasRef}
            role="img"
            aria-label={`The known Zcash network as a sky: ${topology.hubs.length} answering nodes as hubs${
              ghostsTotal === null
                ? ""
                : `, ${formatCount(ghostsTotal)} advertised addresses not answering, hanging off the hubs that advertised them`
            }. Every line means one node told us about an address; none is a connection.`}
          />
          {ready ? null : (
            <p className="net-sky-wait" aria-hidden>
              drawing the sky…
            </p>
          )}
        </div>
        <ul className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-ink-dim">
          {clients.map(([client, count]) => (
            <li key={client} className="flex items-center gap-1.5">
              <ClientMark client={client} size={12} />
              {client} · {count} answered
            </li>
          ))}
          <li
            className="flex items-center gap-1.5 text-ink-faint"
            data-ghosts={ghostsTotal ?? "loading"}
          >
            <span className="net-sw net-sw-hollow" />
            {sky
              ? `not answering · ${formatCount(ghostsTotal ?? 0)}${
                  ghostsTotal !== null && ghostsDrawn < ghostsTotal
                    ? ` · ${formatCount(ghostsDrawn)} drawn`
                    : ""
                }`
              : skyFailed
                ? "not answering · could not be read just now"
                : "not answering · loading"}
          </li>
          <li className="ml-auto text-ink-faint">
            {formatCount(topology.edgesTotal)} advertisements · hub size ∝ addresses it shared
          </li>
        </ul>
        {/* Below the canvas, not over it: an overlay line is unreadable against a dense sky.
            What hubs and dim points are is the lede's job. */}
        <p className="mt-1.5 text-xs text-ink-faint">
          {cam.zoom > PAN_ZOOM
            ? "drag to move · shift-drag to turn · scroll or pinch to zoom · click to pin"
            : "drag to turn · shift-drag or two fingers to move · scroll or pinch to zoom · click to pin"}
        </p>
      </div>
      <TopologyReadout
        topology={topology}
        focus={focus}
        pinned={pinned !== null}
        onPinHub={(index) => setPinned({ kind: "hub", index })}
      />
    </div>
  );
}
