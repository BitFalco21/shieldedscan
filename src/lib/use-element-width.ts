"use client";

import { useCallback, useState } from "react";

/**
 * An element's width in CSS px, kept current as it resizes, through a callback ref. Undefined
 * until measured, and wherever `ResizeObserver` does not exist (some test DOMs), so a caller
 * falls back to its unmeasured layout.
 */
export function useElementWidth<T extends Element>(): [(el: T | null) => void, number | undefined] {
  const [width, setWidth] = useState<number | undefined>(undefined);
  const ref = useCallback((el: T | null) => {
    if (el === null || typeof ResizeObserver === "undefined") return;
    // Read once now: the observer reports after paint, and a chart drawn first at the unmeasured
    // size would flash ticks a third of their size on a phone.
    setWidth(Math.round(el.getBoundingClientRect().width));
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(el);
    // React 19 runs a callback ref's returned cleanup when the element detaches.
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}
