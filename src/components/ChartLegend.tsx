import type { LegendHighlight } from "@/lib/use-legend-highlight";

/** How a series is drawn, so its swatch can be drawn the same way. */
export type LegendMark = "line" | "dashed" | "dotted" | "area" | "bar";

export interface LegendItem {
  label: string;
  /** The same class that colours the series on the chart (`band-shielded`, `flow-2`…). */
  className: string;
  mark: LegendMark;
  /** The series' ink weight: `dim` for the 0.55 steps, `faint` for 0.35, as the chart draws it. */
  weight?: "dim" | "faint";
  /** The series' key on the chart, for a legend that can bring it forward (`onHighlight`). */
  key?: string;
}

export interface ChartLegendProps {
  items: LegendItem[];
  /**
   * Makes each keyed item a control over its chart (`useLegendHighlight`): pointing at or
   * focusing an item previews its series, a click, tap or Enter pins it, and a second one unpins.
   * For a stack, where only the bottom band sits on a flat baseline.
   */
  highlight?: LegendHighlight;
}

const WEIGHT = { dim: "opacity-55", faint: "opacity-35" } as const;

/** The swatch for each mark, sized to read beside 12px text. */
const SWATCH: Record<LegendMark, string> = {
  line: "h-0.5 w-3 bg-current",
  dashed: "w-3 border-t-2 border-dashed border-current",
  dotted: "w-3 border-t-2 border-dotted border-current",
  area: "chart-band h-2.5 w-3 bg-current",
  bar: "h-2.5 w-2 bg-current",
};

/**
 * Which colour is which series, beneath a chart with more than one. The hover readout names a
 * series too, but only at the point under the cursor; a legend answers before anyone hovers, and
 * on a touch screen it is the only answer.
 */
export function ChartLegend({ items, highlight }: ChartLegendProps) {
  if (items.length < 2) return null;
  return (
    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-dim">
      {items.map((item) => {
        const swatch = (
          <>
            <span aria-hidden className={`inline-flex items-center ${item.className}`}>
              <span
                className={`inline-block ${SWATCH[item.mark]} ${item.weight ? WEIGHT[item.weight] : ""}`}
              />
            </span>
            {item.label}
          </>
        );
        const key = item.key;
        if (!highlight || key === undefined) {
          return (
            <li key={item.label} className="flex items-center gap-1.5">
              {swatch}
            </li>
          );
        }
        const { highlighted, pinned } = highlight;
        const faded = highlighted !== null && highlighted !== key;
        return (
          <li key={key}>
            <button
              type="button"
              // Pressed means pinned: a preview is transient and never announced as a state.
              aria-pressed={pinned === key}
              onPointerEnter={() => highlight.preview(key)}
              onPointerLeave={() => highlight.preview(null)}
              onFocus={() => highlight.preview(key)}
              onBlur={() => highlight.preview(null)}
              onClick={() => highlight.togglePin(key)}
              className={`flex cursor-pointer items-center gap-1.5 transition-opacity hover:text-ink motion-reduce:transition-none ${
                faded ? "opacity-35" : highlighted === key ? "text-ink" : ""
              }`}
            >
              {swatch}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
