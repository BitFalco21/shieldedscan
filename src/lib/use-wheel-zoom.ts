"use client";

import { useEffect, useRef, type RefObject } from "react";

/** Pixels per line / per page, for the rare `deltaMode` values that are not pixels. */
const LINE_PX = 16;
const PAGE_PX = 800;
/** ln(1.15) / 100: one ~100 px wheel notch zooms ×1.15. */
const WHEEL_RATE = Math.log(1.15) / 100;
/** A pinch's deltas are ~10x smaller per event, so it gets a proportionally larger rate. */
const PINCH_RATE = 0.01;
/** No single event may zoom more than this, however large its delta. */
const MAX_STEP = 1.5;

/**
 * The multiplicative zoom one wheel event asks for, proportional to the gesture rather than one
 * fixed step per event: a mouse wheel sends ~100 px per notch, while a trackpad pinch (which
 * arrives as ctrl+wheel) sends dozens of events of 1–10 px, and a fixed step per event would race
 * to the zoom limit.
 */
export function wheelFactor(deltaY: number, deltaMode: number, ctrlKey: boolean): number {
  const px = deltaMode === 1 ? deltaY * LINE_PX : deltaMode === 2 ? deltaY * PAGE_PX : deltaY;
  const f = Math.exp(-px * (ctrlKey ? PINCH_RATE : WHEEL_RATE));
  return Math.min(MAX_STEP, Math.max(1 / MAX_STEP, f));
}

/**
 * A wheel listener that can cancel the browser's own response: page scroll, and the page zoom
 * a trackpad pinch or ctrl+wheel triggers.
 *
 * React registers `onWheel` as a passive listener (React 17+), so `e.preventDefault()` in a
 * React handler is ignored and the page zooms along with the element. This attaches a native
 * `{ passive: false }` listener once per mount, with the handler kept in a ref so a new closure
 * per render does not re-attach it.
 */
export function useWheelZoom<T extends HTMLElement>(
  ref: RefObject<T | null>,
  onWheel: (e: WheelEvent) => void,
): void {
  const handler = useRef(onWheel);
  // Written in an effect, never during render (the lint rule exists because a render can be
  // discarded); the listener below reads the ref at event time, so it always sees the newest.
  useEffect(() => {
    handler.current = onWheel;
  });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const listen = (e: WheelEvent) => {
      e.preventDefault();
      handler.current(e);
    };
    el.addEventListener("wheel", listen, { passive: false });
    return () => el.removeEventListener("wheel", listen);
  }, [ref]);
}
