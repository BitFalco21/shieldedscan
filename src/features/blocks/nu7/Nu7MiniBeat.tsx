"use client";

import { useEffect, useRef } from "react";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import { PROBE_CLASSES, readPalette } from "./heartbeat-draw";

export interface Nu7MiniBeatProps {
  /** Before activation the beat is slow and amber; after it, three times faster and green. */
  active: boolean;
}

const WIDTH = 34;
const HEIGHT = 14;

/**
 * The site bar's tiny heartbeat: one blip sweeping across, at a third of the speed before NU7
 * that it runs after it. Decorative; under reduced motion it is one still blip.
 */
export function Nu7MiniBeat({ active }: Nu7MiniBeatProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const probe = useRef<HTMLSpanElement>(null);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    const el = canvas.current;
    const g = el?.getContext("2d");
    if (!el || !g || !probe.current) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    el.width = WIDTH * dpr;
    el.height = HEIGHT * dpr;
    const palette = readPalette(probe.current);
    const colour = active ? palette.green : palette.warn;
    const period = active ? 800 : 2_400;

    const draw = (phase: number) => {
      const w = el.width;
      const mid = el.height * 0.6;
      const at = phase * w;
      g.clearRect(0, 0, w, el.height);
      g.strokeStyle = colour;
      g.lineWidth = 1.5 * dpr;
      g.beginPath();
      g.moveTo(0, mid);
      for (let x = 0; x <= w; x += 1) {
        const d = Math.abs(x - at);
        g.lineTo(x, d < 6 * dpr ? mid - (6 * dpr - d) * 1.6 : mid);
      }
      g.stroke();
    };

    if (reducedMotion) {
      draw(0.5);
      return;
    }
    let frame = requestAnimationFrame(function loop(t) {
      draw((t % period) / period);
      frame = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(frame);
  }, [active, reducedMotion]);

  return (
    <>
      <canvas ref={canvas} aria-hidden="true" className="h-3.5 w-[34px] shrink-0" />
      <span ref={probe} hidden>
        {PROBE_CLASSES.map((c) => (
          <span key={c} className={c} />
        ))}
      </span>
    </>
  );
}
