"use client";

import { useSyncExternalStore } from "react";

/** Below Tailwind's `sm`: the width the site lays out for a phone. */
const QUERY = "(max-width: 639px)";

function phoneQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(QUERY);
}

function subscribe(onChange: () => void): () => void {
  const query = phoneQuery();
  if (query === null) return () => {};
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * Whether the viewport is a phone's, kept current as it resizes. False on the server and before
 * hydration, and where `matchMedia` does not exist, so the server markup is the desktop layout.
 */
export function usePhoneViewport(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => phoneQuery()?.matches ?? false,
    () => false,
  );
}
