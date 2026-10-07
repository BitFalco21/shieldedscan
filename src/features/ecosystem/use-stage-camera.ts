"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HOME_2D, easeOutCubic, lerpCamera, type Camera } from "./camera";

/** How long a requested glide (search, reset, zoom buttons, 2D/3D) takes. */
const GLIDE_MS = 560;

/**
 * The stage's camera: state for rendering, a ref for handlers that must read the latest value
 * between renders, and glides a reader asked for. Under `prefers-reduced-motion` a glide jumps.
 */
export function useStageCamera() {
  const [cam, setCamState] = useState<Camera>(HOME_2D);
  const camRef = useRef<Camera>(HOME_2D);
  const frame = useRef<number | null>(null);
  const pending = useRef<Camera | null>(null);
  const glide = useRef<number | null>(null);

  /** Commit a camera on the next animation frame: many pointer events, one render. */
  const setCam = useCallback((next: Camera) => {
    camRef.current = next;
    pending.current = next;
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      if (pending.current) setCamState(pending.current);
      pending.current = null;
    });
  }, []);

  const stopGlide = useCallback(() => {
    if (glide.current !== null) cancelAnimationFrame(glide.current);
    glide.current = null;
  }, []);

  const glideTo = useCallback(
    (target: Camera) => {
      stopGlide();
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      if (reduce) {
        setCam(target);
        return;
      }
      const from = camRef.current;
      const t0 = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / GLIDE_MS);
        setCam(lerpCamera(from, target, easeOutCubic(t)));
        glide.current = t < 1 ? requestAnimationFrame(step) : null;
      };
      glide.current = requestAnimationFrame(step);
    },
    [setCam, stopGlide],
  );

  useEffect(
    () => () => {
      stopGlide();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [stopGlide],
  );

  return { cam, camRef, setCam, glideTo, stopGlide };
}
