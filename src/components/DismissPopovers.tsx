"use client";

import { useEffect } from "react";

/**
 * Closes an open `<details>` popover when the reader clicks away, or presses Escape.
 *
 * The popovers on this site are `<details>`/`<summary>` so they work with scripting off, at
 * the cost of the browser only closing one when its own summary is clicked again. This
 * enhancement restores click-away; with no JavaScript the menus still open and choose, and
 * simply stay open until dismissed by their summary.
 *
 * Opt-in via `data-popover`: many `<details>` on this site are content, not popovers — the
 * raw-hex panel, a block's extra facts, the `/api-docs` contents — and must not collapse when
 * the reader clicks the page.
 *
 * Mounted once, in the root layout, so there is one listener rather than one per popover.
 */
export function DismissPopovers() {
  useEffect(() => {
    const openPopovers = () =>
      Array.from(document.querySelectorAll<HTMLDetailsElement>("details[data-popover][open]"));

    const onPointerDown = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      // Anything inside the popover is its own business — choosing an option, toggling the
      // summary shut, or scrolling a long chain list.
      for (const details of openPopovers()) {
        if (!details.contains(target)) details.open = false;
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const open = openPopovers();
      if (open.length === 0) return;
      for (const details of open) {
        details.open = false;
        // Focus goes back to the control that opened it, or a keyboard reader is left
        // stranded at the top of the document with no idea where they are.
        if (details.contains(document.activeElement)) {
          details.querySelector("summary")?.focus();
        }
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return null;
}
