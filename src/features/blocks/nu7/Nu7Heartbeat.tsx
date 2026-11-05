"use client";

import { useEffect, useRef } from "react";
import { NU7_HEIGHT, targetSpacingAt, type BlockSummary } from "@/domain";
import { nowSeconds } from "@/lib/clock";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import { PROBE_CLASSES, TRACE_HEIGHT, drawHeartbeat, readPalette } from "./heartbeat-draw";
import { HEARTBEAT_WINDOW_MINUTES, heartbeatModel } from "./nu7-countdown";

export interface Nu7HeartbeatProps {
  blocks: readonly BlockSummary[];
  tipHeight: number;
  tipTimestamp: number;
  /** The activation was watched: the trace flashes amber once. */
  flash?: boolean;
}

/**
 * The chain's heartbeat: the last forty minutes of real blocks as an oscilloscope trace. It
 * scrolls with the clock once a second; under reduced motion it is redrawn only when a block
 * arrives or the box resizes.
 */
export function Nu7Heartbeat({
  blocks,
  tipHeight,
  tipTimestamp,
  flash = false,
}: Nu7HeartbeatProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const probe = useRef<HTMLSpanElement>(null);
  const reducedMotion = usePrefersReducedMotion();
  const step = targetSpacingAt(tipHeight);
  const before = targetSpacingAt(NU7_HEIGHT - 1);

  useEffect(() => {
    const el = canvas.current;
    const probeEl = probe.current;
    const g = el?.getContext("2d");
    if (!el || !probeEl || !g) return;

    const draw = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const width = Math.round(el.clientWidth * dpr);
      const height = Math.round(TRACE_HEIGHT * dpr);
      if (el.width !== width) el.width = width;
      if (el.height !== height) el.height = height;
      // Never earlier than the newest block, so a machine clock set behind the chain cannot
      // push the trace off to the right.
      const now = Math.max(nowSeconds(), tipTimestamp);
      const tip = { height: tipHeight, lastBlockTimestamp: tipTimestamp };
      // The same breakpoint as the caption's `sm:` swap.
      const wide = window.matchMedia?.("(min-width: 640px)").matches ?? true;
      const span = HEARTBEAT_WINDOW_MINUTES[wide ? "wide" : "narrow"] * 60;
      const model = heartbeatModel(blocks, tip, now, span);
      drawHeartbeat(g, width, height, dpr, model, now, span, readPalette(probeEl));
    };

    draw();
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(draw);
    resize?.observe(el);
    const timer = reducedMotion ? undefined : setInterval(draw, 1_000);
    return () => {
      resize?.disconnect();
      if (timer !== undefined) clearInterval(timer);
    };
  }, [blocks, tipHeight, tipTimestamp, reducedMotion]);

  return (
    <figure className="relative mt-6 border border-green-faint bg-panel">
      <span className="microlabel absolute top-2 left-3 text-ink-faint">heartbeat</span>
      <span className="absolute top-2 right-3 text-xs text-ink-dim">
        target <b className="text-green">{step} s</b>
        {step === before ? null : <> · was {before} s</>}
      </span>
      {flash ? (
        <span
          aria-hidden="true"
          className="nu7-flash pointer-events-none absolute inset-0 bg-warn"
        />
      ) : null}
      <canvas
        ref={canvas}
        role="img"
        aria-label="Recent blocks over time, one spike per block"
        className="block h-[150px] w-full"
      />
      <figcaption className="flex flex-wrap justify-between gap-2.5 border-t border-green-faint px-3 py-2 text-[11px] text-ink-faint">
        <span>
          <span className="text-ink-dim">each spike is a block</span>, spaced by real time · last{" "}
          <span className="sm:hidden">{HEARTBEAT_WINDOW_MINUTES.narrow}</span>
          <span className="hidden sm:inline">{HEARTBEAT_WINDOW_MINUTES.wide}</span> min
        </span>
        <span>▸ activation in amber</span>
      </figcaption>
      <span ref={probe} hidden>
        {PROBE_CLASSES.map((c) => (
          <span key={c} className={c} />
        ))}
      </span>
    </figure>
  );
}
