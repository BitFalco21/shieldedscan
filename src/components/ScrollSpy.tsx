"use client";

import { useEffect } from "react";

export interface ScrollSpyProps {
  /** Section ids to track, in document order. */
  ids: string[];
}

/**
 * Marks the sidebar link for whichever section is currently on screen.
 *
 * `:target` only reacts to a click, so this observes the sections and stamps
 * `aria-current="location"` on the matching links, which the stylesheet renders. Screen readers
 * understand that attribute as "you are here", so the state is not conveyed by colour alone.
 *
 * It renders nothing, stores nothing, and touches no history — no `pushState` rewriting the
 * URL as you read, which would poison the back button. Without JavaScript the sidebar is still
 * a working list of anchor links: the highlight is the enhancement.
 */
export function ScrollSpy({ ids }: ScrollSpyProps) {
  useEffect(() => {
    // No observer, no highlight — the anchors still navigate (jsdom, old browsers).
    if (typeof IntersectionObserver === "undefined") return;
    const sections = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (sections.length === 0) return;

    // Which sections are intersecting right now. IntersectionObserver reports only what
    // CHANGED, so the callback cannot recompute "topmost visible" from its entries alone.
    const visible = new Set<string>();

    // The last section, when it is entirely on screen. A short final section can never reach
    // the band — the document ends first — so a last section wholly in view means the reader is
    // at the end. A tall last section lights by the band rule.
    let endInView = false;
    const last = sections[sections.length - 1]!;

    // The section the reader asked for, by clicking an anchor or arriving on its hash. It wins
    // until they scroll by hand; otherwise the end-of-page rule would override a click on the
    // second-to-last section. `scroll` itself cannot clear it — the jump to the anchor is a
    // scroll — so only the reader's own input does.
    const idSet = new Set(ids);
    const fromHash = decodeURIComponent(window.location.hash.slice(1));
    let pinned: string | null = idSet.has(fromHash) ? fromHash : null;

    const mark = () => {
      // Topmost visible section wins — reading order, not observation order — except at the
      // end of the page, where the last section wins outright.
      const current = pinned ?? (endInView ? last.id : ids.find((id) => visible.has(id)));
      for (const id of ids) {
        for (const link of document.querySelectorAll(`a[href="#${id}"]`)) {
          if (id === current) link.setAttribute("aria-current", "location");
          else link.removeAttribute("aria-current");
        }
      }
    };

    // A band across the upper page: a section counts as "current" once its top passes
    // the header and until it has scrolled well up. Without the negative bottom margin
    // the last sections on a long page never win, because everything below the fold
    // intersects at once.
    const band = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        mark();
      },
      { rootMargin: "-80px 0px -55% 0px", threshold: 0 },
    );
    const tail = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) endInView = entry.intersectionRatio >= 1;
        mark();
      },
      { rootMargin: "-80px 0px 0px 0px", threshold: 1 },
    );
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.('a[href^="#"]');
      const id = link ? decodeURIComponent(link.getAttribute("href")!.slice(1)) : "";
      if (!idSet.has(id)) return;
      pinned = id;
      mark();
    };
    const unpin = () => {
      if (pinned === null) return;
      pinned = null;
      mark();
    };
    const onKey = (event: KeyboardEvent) => {
      // Only keys that scroll; Tab and Enter move focus or follow a link, and a link's own
      // Enter must not undo the pin it is about to set.
      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key))
        unpin();
    };
    document.addEventListener("click", onClick);
    window.addEventListener("wheel", unpin, { passive: true });
    window.addEventListener("touchmove", unpin, { passive: true });
    window.addEventListener("keydown", onKey);

    for (const section of sections) band.observe(section);
    tail.observe(last);
    return () => {
      band.disconnect();
      tail.disconnect();
      document.removeEventListener("click", onClick);
      window.removeEventListener("wheel", unpin);
      window.removeEventListener("touchmove", unpin);
      window.removeEventListener("keydown", onKey);
    };
  }, [ids]);

  return null;
}
