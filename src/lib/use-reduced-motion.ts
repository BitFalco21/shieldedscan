"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/** The media query, or null where `matchMedia` does not exist (old engines, some test DOMs). */
function reducedMotionQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(QUERY);
}

/**
 * Whether the reader asked for less motion, read once at the moment of an action: a click that
 * would start an animation checks this and jumps straight to the end instead.
 */
export function prefersReducedMotion(): boolean {
  return reducedMotionQuery()?.matches ?? false;
}

function subscribe(onChange: () => void): () => void {
  const query = reducedMotionQuery();
  if (query === null) return () => {};
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * Whether the reader asked for less motion, kept current if they change the setting while the
 * page is open. False on the server and before hydration, so the server markup is the moving
 * version and a reduced-motion reader switches to the still one on mount.
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, prefersReducedMotion, () => false);
}
