"use client";

import { useRef } from "react";

/** How far down a drag on the handle must travel to close the sheet. */
const CLOSE_DRAG_PX = 60;

export interface ZenoSheetHandleProps {
  onDragClose: () => void;
}

/**
 * The phone sheet's grab bar. A sheet's handle invites a downward swipe, so a swipe past a short
 * threshold closes it. Hidden from assistive technology, which has the close button; the sheet
 * does not follow the finger, which would need a per-frame inline transform.
 */
export function ZenoSheetHandle({ onDragClose }: ZenoSheetHandleProps) {
  const startY = useRef<number | null>(null);
  return (
    <div
      aria-hidden
      onPointerDown={(event) => {
        startY.current = event.clientY;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerUp={(event) => {
        const from = startY.current;
        startY.current = null;
        if (from !== null && event.clientY - from > CLOSE_DRAG_PX) onDragClose();
      }}
      onPointerCancel={() => {
        startY.current = null;
      }}
      className="flex h-6 flex-none touch-none items-center justify-center sm:hidden"
    >
      <span className="h-1 w-10 rounded-full bg-edge-strong" />
    </div>
  );
}
