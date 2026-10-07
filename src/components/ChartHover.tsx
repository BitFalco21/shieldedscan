"use client";

import { useCallback, useRef, useState } from "react";

export interface ChartHoverRow {
  /** Series name, as it appears in the legend. */
  name: string;
  /**
   * Pre-formatted value per x position, one string per index.
   *
   * Formatted by the chart's own `formatValue`, so the readout provably agrees with the axis:
   * one formatter, not two.
   *
   * `null` at an index omits the row there — "this series does not exist at this point", as
   * against a measured value. A pool before its activation must not read as "0.00 ZEC".
   */
  values: (string | null)[];
  /** Token class carrying the band's colour, so the swatch matches the band. */
  colorClass?: string;
}

export interface ChartHoverProps {
  /** One label per x position. Spell years out — a readout has no axis to borrow context from. */
  labels: string[];
  rows: ChartHoverRow[];
  /**
   * An extra emphasised row, for a stacked chart's total. Stacked bands are read from the top
   * edge, so the total is the number the reader is actually looking at.
   */
  total?: { name: string; values: string[] };
  /**
   * Where the plot area starts and ends as a fraction of the rendered width. Charts with a
   * y-axis gutter must pass it, or the crosshair lands slightly off every point.
   */
  plotStart?: number;
  plotEnd?: number;
  /**
   * `points` places x positions *on* the plot edges (line and area charts, where index 0 sits
   * at the left edge). `bands` places them in the middle of equal slices (bar charts, where
   * index 0 is a bar occupying the first slice). Using the wrong one is a half-slice error.
   */
  mode?: "points" | "bands";
  children: React.ReactNode;
}

/**
 * A hover and keyboard readout laid over a chart.
 *
 * The chart itself stays a Server Component: it passes down already-formatted strings and this
 * wrapper handles pointers. The crosshair and the panel are **HTML**, not SVG, on purpose —
 * every chart here sets `preserveAspectRatio="none"` with a different viewBox, so anything
 * drawn in user units would need its own scale correction per chart, and text would stretch.
 * A positioned div needs one number: the fraction along the plot area.
 *
 * Keyboard-operable because a chart that only answers to a mouse answers to no phone and no
 * screen reader. Arrow keys step, Home/End jump, Escape dismisses.
 */
export function ChartHover({
  labels,
  rows,
  total,
  plotStart = 0,
  plotEnd = 1,
  mode = "points",
  children,
}: ChartHoverProps) {
  const [active, setActive] = useState<number | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const count = labels.length;

  const indexFromClientX = useCallback(
    (clientX: number): number | null => {
      const box = wrapper.current?.getBoundingClientRect();
      if (!box || box.width === 0 || count === 0) return null;
      const fraction = (clientX - box.left) / box.width;
      const span = plotEnd - plotStart;
      if (span <= 0) return null;
      const withinPlot = (fraction - plotStart) / span;
      // Bands: index 0 owns the first 1/count of the plot, so floor. Points: index 0 sits at
      // the left edge and index n-1 at the right, so round to the nearest.
      const raw =
        mode === "bands" ? Math.floor(withinPlot * count) : Math.round(withinPlot * (count - 1));
      return Math.min(count - 1, Math.max(0, raw));
    },
    [count, mode, plotEnd, plotStart],
  );

  /** Where the crosshair sits, as a percentage of the wrapper's width. */
  const offsetFor = (index: number): number => {
    const span = plotEnd - plotStart;
    const within = mode === "bands" ? (index + 0.5) / count : count > 1 ? index / (count - 1) : 0.5;
    return (plotStart + within * span) * 100;
  };

  const step = (delta: number) =>
    setActive((current) => {
      const next = (current ?? 0) + delta;
      return Math.min(count - 1, Math.max(0, next));
    });

  if (count === 0) return <>{children}</>;

  const readoutLeft = offsetFor(active ?? 0);
  // Flip the panel to the left of the crosshair past the midpoint so it never leaves the
  // chart's container.
  const flip = readoutLeft > 55;

  return (
    <div
      ref={wrapper}
      /*
        `touch-pan-y` makes this work with a finger: without it the browser claims a
        horizontal drag for scrolling and fires `pointercancel`. `pan-y` gives vertical drags
        back to the page and keeps horizontal ones, which is the gesture this reads.
      */
      className="relative touch-pan-y"
      // `group` is not used: the readout is driven by state, not by CSS hover, because the
      // keyboard path has to reach the identical rendering.
      onPointerMove={(event) => setActive(indexFromClientX(event.clientX))}
      onPointerLeave={() => setActive(null)}
      onPointerDown={(event) => {
        // Capture, so the readout keeps tracking when a finger slides outside the chart.
        event.currentTarget.setPointerCapture?.(event.pointerId);
        setActive(indexFromClientX(event.clientX));
      }}
      onPointerUp={(event) => event.currentTarget.releasePointerCapture?.(event.pointerId)}
      onPointerCancel={() => setActive(null)}
      onFocus={() => setActive((current) => current ?? 0)}
      onBlur={() => setActive(null)}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight") step(1);
        else if (event.key === "ArrowLeft") step(-1);
        else if (event.key === "Home") setActive(0);
        else if (event.key === "End") setActive(count - 1);
        else if (event.key === "Escape") setActive(null);
        else return;
        event.preventDefault();
      }}
      tabIndex={0}
      role="group"
      aria-label="Chart — use the arrow keys to read values by period"
    >
      {children}

      {active !== null ? (
        <>
          {/*
            The two `style` props in this file are the only ones permitted in `src/`. They
            carry geometry, never appearance: `readoutLeft` is derived from the pointer on
            every move, a continuous runtime value no utility class can express. Inside an SVG,
            use an attribute instead.
          */}
          <div
            aria-hidden
            className="pointer-events-none absolute top-0 bottom-0 w-px bg-green/60"
            style={{ left: `${readoutLeft}%` }}
          />
          <div
            className={`panel pointer-events-none absolute top-1 z-10 min-w-40 px-3 py-2 text-xs ${
              flip ? "-translate-x-full" : ""
            }`}
            style={{ left: `${readoutLeft}%`, marginLeft: flip ? "-8px" : "8px" }}
            // Announced as a live region so a keyboard reader hears the value change as they
            // step, instead of silently moving a crosshair they cannot see.
            role="status"
            aria-live="polite"
          >
            <div className="microlabel text-ink-dim">{labels[active]}</div>
            <dl className="mt-1.5 space-y-0.5">
              {/*
                Filtered on the active index, so a series drops out of the readout only where it
                does not exist. `?? "—"` below still covers a ragged array, a different fault.
              */}
              {rows
                .filter((row) => row.values[active] !== null)
                .map((row) => (
                  <div key={row.name} className="flex items-center justify-between gap-3">
                    <dt className="flex items-center gap-1.5 text-ink-dim">
                      {row.colorClass ? (
                        <span
                          aria-hidden
                          className={`h-2 w-2 shrink-0 rounded-sm ${row.colorClass}`}
                        >
                          <svg viewBox="0 0 10 10" className="h-2 w-2">
                            <rect width="10" height="10" fill="currentColor" opacity="0.82" />
                          </svg>
                        </span>
                      ) : null}
                      {row.name}
                    </dt>
                    <dd className="text-ink tabular-nums">{row.values[active] ?? "—"}</dd>
                  </div>
                ))}
              {total ? (
                <div className="mt-1 flex items-center justify-between gap-3 border-t border-edge-faint pt-1">
                  <dt className="text-ink-dim">{total.name}</dt>
                  <dd className="text-ink-bright tabular-nums">{total.values[active] ?? "—"}</dd>
                </div>
              ) : null}
            </dl>
          </div>
        </>
      ) : null}
    </div>
  );
}
