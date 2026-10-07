import { useRef, type KeyboardEvent } from "react";

export interface RovingTabs {
  /** Ref callback for the tab at `index`, so arrow keys can move focus to it. */
  tabRef: (index: number) => (el: HTMLButtonElement | null) => void;
  /** For the `role="tablist"` element: Left and Right select the neighbouring tab, wrapping. */
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
}

/**
 * Keyboard support for the ARIA tab pattern: one tab in the tab order at a time, and the arrow
 * keys select and focus the next or previous tab. The caller owns which tab is active.
 */
export function useRovingTabs(
  count: number,
  active: number,
  setActive: (index: number) => void,
): RovingTabs {
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  return {
    tabRef: (index) => (el) => {
      tabs.current[index] = el;
    },
    onKeyDown: (e) => {
      const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (step === 0) return;
      e.preventDefault();
      const next = (active + step + count) % count;
      setActive(next);
      tabs.current[next]?.focus();
    },
  };
}
