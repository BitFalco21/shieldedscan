import type { ReactNode } from "react";

/** One series in a thumbnail, coloured as its full chart colours it. */
export interface ThumbSeries {
  /** Oldest first. In a line, a null is a gap; in a stack, a band that has not begun yet. */
  values: (number | null)[];
  /** The class that sets `color` on the full chart (`band-shielded`, a pool's flow class…). */
  className: string;
  opacity?: number;
}

/**
 * A chart in miniature, in the same form as the chart itself: a stack stays a stack, a flow
 * stays bars either side of zero, several lines stay several lines. A card can then say what
 * kind of chart opens behind it, not only that something went up.
 */
export type ChartThumb =
  | { kind: "stack"; series: ThumbSeries[] }
  | { kind: "lines"; series: ThumbSeries[]; max?: number }
  | { kind: "area"; series: ThumbSeries }
  | { kind: "bars"; series: ThumbSeries }
  | { kind: "stacked-bars"; series: ThumbSeries[] }
  | { kind: "flow"; inValues: (number | null)[]; outValues: (number | null)[] };

export interface ChartThumbnailProps {
  thumb: ChartThumb;
  className?: string;
}

/** The plot box. The SVG stretches it to its CSS size; strokes keep their pixel width. */
const W = 120;
const H = 40;
const PAD = 1;

const x = (i: number, n: number) => (n <= 1 ? 0 : (i / (n - 1)) * W);

/** A line through present values, one subpath per unbroken run. */
function linePath(values: (number | null)[], y: (v: number) => number): string {
  let d = "";
  let pen = false;
  values.forEach((v, i) => {
    if (v === null) {
      pen = false;
      return;
    }
    d += `${pen ? "L" : "M"}${x(i, values.length).toFixed(2)},${y(v).toFixed(2)}`;
    pen = true;
  });
  return d;
}

const finiteMax = (values: (number | null)[]) =>
  Math.max(0, ...values.filter((v): v is number => v !== null && Number.isFinite(v)));

/**
 * Every thumbnail starts its axis at zero, as the full charts do: a sparkline scaled to its own
 * range would turn a 2% wobble into a cliff. Decorative to a screen reader, because the card
 * states the chart's title and figure in text.
 */
export function ChartThumbnail({ thumb, className = "" }: ChartThumbnailProps) {
  const svg = (children: ReactNode) => (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-hidden
      className={`block w-full ${className}`.trim()}
    >
      {children}
    </svg>
  );

  if (thumb.kind === "stack") {
    const n = Math.max(0, ...thumb.series.map((s) => s.values.length));
    if (n < 2) return null;
    // Cumulative tops, bottom band first: the full chart's stacking order.
    const tops: number[][] = [];
    thumb.series.forEach((s, si) => {
      tops.push(
        Array.from(
          { length: n },
          (_, i) => (si === 0 ? 0 : tops[si - 1]![i]!) + (s.values[i] ?? 0),
        ),
      );
    });
    const max = Math.max(...tops.at(-1)!) || 1;
    const y = (v: number) => H - PAD - (v / max) * (H - 2 * PAD);
    return svg(
      thumb.series.map((s, si) => {
        const top = tops[si]!;
        const below = si === 0 ? new Array<number>(n).fill(0) : tops[si - 1]!;
        const up = top.map(
          (v, i) => `${i === 0 ? "M" : "L"}${x(i, n).toFixed(2)},${y(v).toFixed(2)}`,
        );
        const down = below.map((v, i) => `L${x(i, n).toFixed(2)},${y(v).toFixed(2)}`).reverse();
        return (
          <path
            key={si}
            d={`${up.join("")}${down.join("")}Z`}
            fill="currentColor"
            className={`chart-band ${s.className}`}
          />
        );
      }),
    );
  }

  if (thumb.kind === "lines") {
    const max = thumb.max ?? (Math.max(...thumb.series.map((s) => finiteMax(s.values))) || 1);
    const y = (v: number) => H - PAD - (Math.min(v, max) / max) * (H - 2 * PAD);
    const drawn = thumb.series.filter((s) => s.values.filter((v) => v !== null).length >= 2);
    if (drawn.length === 0) return null;
    return svg(
      drawn.map((s, si) => (
        <path
          key={si}
          d={linePath(s.values, y)}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
          opacity={s.opacity ?? 1}
          className={s.className}
        />
      )),
    );
  }

  if (thumb.kind === "area") {
    const values = thumb.series.values;
    if (values.filter((v) => v !== null).length < 2) return null;
    const max = finiteMax(values) || 1;
    const y = (v: number) => H - PAD - (v / max) * (H - 2 * PAD);
    const line = linePath(values, y);
    // The fill closes only under the first unbroken run, so a gap never fills as zero.
    const first = values.findIndex((v) => v !== null);
    const run = values.slice(first).findIndex((v) => v === null);
    const last = run === -1 ? values.length - 1 : first + run - 1;
    const fill = `${linePath(values.slice(0, last + 1), y)}L${x(last, values.length).toFixed(2)},${H}L${x(first, values.length).toFixed(2)},${H}Z`;
    return svg(
      <g className={thumb.series.className}>
        <path d={fill} fill="currentColor" opacity={0.08} />
        <path
          d={line}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      </g>,
    );
  }

  if (thumb.kind === "stacked-bars") {
    const n = thumb.series[0]?.values.length ?? 0;
    if (n < 2) return null;
    const totals = Array.from({ length: n }, (_, i) =>
      thumb.series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0),
    );
    const max = finiteMax(totals) || 1;
    const slot = W / n;
    const bar = Math.max(slot * 0.7, 0.6);
    const base = new Array<number>(n).fill(0);
    return svg(
      thumb.series.map((s, si) => (
        <g key={si} className={s.className}>
          {s.values.map((v, i) => {
            if (v === null || v <= 0) return null;
            const height = (v / max) * (H - 2 * PAD);
            const top = H - PAD - ((base[i] ?? 0) / max) * (H - 2 * PAD) - height;
            base[i] = (base[i] ?? 0) + v;
            return (
              <rect
                key={i}
                x={i * slot}
                y={top}
                width={bar}
                height={height}
                fill="currentColor"
                className="chart-band"
              />
            );
          })}
        </g>
      )),
    );
  }

  if (thumb.kind === "bars") {
    const values = thumb.series.values;
    const n = values.length;
    if (n < 2) return null;
    const max = finiteMax(values) || 1;
    const slot = W / n;
    const bar = Math.max(slot * 0.7, 0.6);
    return svg(
      <g className={thumb.series.className}>
        {values.map((v, i) =>
          v === null || v === 0 ? null : (
            <rect
              key={i}
              x={i * slot}
              y={H - PAD - (v / max) * (H - 2 * PAD)}
              width={bar}
              height={(v / max) * (H - 2 * PAD)}
              fill="currentColor"
            />
          ),
        )}
      </g>,
    );
  }

  // Flow: inbound above the midline at full ink, outbound below it faded, one shared scale, as
  // `FlowBalanceChart` draws them. The gap between the two is the net.
  const n = thumb.inValues.length;
  if (n < 2) return null;
  const max = Math.max(finiteMax(thumb.inValues), finiteMax(thumb.outValues)) || 1;
  const mid = H / 2;
  const slot = W / n;
  const bar = Math.max(slot * 0.7, 0.6);
  const h = (v: number | null) => ((v ?? 0) / max) * (mid - PAD);
  return svg(
    <g className="text-series">
      <line x1={0} x2={W} y1={mid} y2={mid} stroke="currentColor" strokeWidth={0.5} opacity={0.4} />
      {thumb.inValues.map((v, i) => (
        <rect
          key={`i${i}`}
          x={i * slot}
          y={mid - h(v)}
          width={bar}
          height={h(v)}
          fill="currentColor"
        />
      ))}
      {thumb.outValues.map((v, i) => (
        <rect
          key={`o${i}`}
          x={i * slot}
          y={mid}
          width={bar}
          height={h(v)}
          fill="currentColor"
          opacity={0.35}
        />
      ))}
    </g>,
  );
}
