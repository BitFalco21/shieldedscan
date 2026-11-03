"use client";

import { useEffect, useSyncExternalStore, type RefObject } from "react";

/** Below Tailwind's `sm`, where the panel is a bottom sheet over most of the screen. */
const PHONE = "(max-width: 39.99rem)";

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(PHONE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * Make the open panel modal on a phone, and only there.
 *
 * Beside a desktop page the panel is a companion and the page stays usable. On a phone it covers
 * nearly the whole screen, so a page left in the tab order would take focus somewhere the reader
 * cannot see: every other child of `<body>` is made `inert` and the page stops scrolling under the
 * sheet. Returns whether that is in force, for `aria-modal`.
 */
export function useSheetModal(panel: RefObject<HTMLElement | null>, open: boolean): boolean {
  const phone = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(PHONE).matches,
    () => false,
  );
  const modal = open && phone;

  useEffect(() => {
    const el = panel.current;
    if (!modal || el === null) return;
    // The body child holding the panel, whatever wraps it.
    let own: Element = el;
    while (own.parentElement !== null && own.parentElement !== document.body) {
      own = own.parentElement;
    }
    const silenced = Array.from(document.body.children).filter(
      (child): child is HTMLElement =>
        child !== own &&
        child instanceof HTMLElement &&
        !child.inert &&
        // Scripts have nothing to silence, and the route announcer must keep speaking.
        child.tagName !== "SCRIPT" &&
        child.tagName !== "NEXT-ROUTE-ANNOUNCER",
    );
    for (const child of silenced) child.inert = true;
    const root = document.documentElement;
    root.classList.add("overflow-hidden");
    return () => {
      for (const child of silenced) child.inert = false;
      root.classList.remove("overflow-hidden");
    };
  }, [modal, panel]);

  return modal;
}
