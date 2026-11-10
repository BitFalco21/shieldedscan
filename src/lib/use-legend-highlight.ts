"use client";

import { useCallback, useMemo, useState } from "react";

/** A legend's hold on its chart: which series is brought forward, and how it got there. */
export interface LegendHighlight {
  /** The series brought forward: the pinned one, else the one previewed. */
  highlighted: string | null;
  /** A series a click, tap or Enter fixed, until it is clicked again. */
  pinned: string | null;
  /** Pointing at or focusing an item: a preview that leaving clears, never a pin. */
  preview: (key: string | null) => void;
  /** Pins `key`, or unpins it when it is the one pinned. */
  togglePin: (key: string) => void;
}

/**
 * A preview follows the pointer and the focus; a pin stays. Kept apart because a tap on a phone
 * sends `pointerenter`, `pointerleave` and `click` in that order: a leave that cleared everything
 * would undo the tap the moment the finger lifts.
 */
export function useLegendHighlight(): LegendHighlight {
  const [pinned, setPinned] = useState<string | null>(null);
  const [previewed, setPreviewed] = useState<string | null>(null);
  const togglePin = useCallback(
    (key: string) => setPinned((current) => (current === key ? null : key)),
    [],
  );
  return useMemo(
    () => ({ highlighted: pinned ?? previewed, pinned, preview: setPreviewed, togglePin }),
    [pinned, previewed, togglePin],
  );
}
