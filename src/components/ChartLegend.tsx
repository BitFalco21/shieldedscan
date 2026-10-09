/** How a series is drawn, so its swatch can be drawn the same way. */
export type LegendMark = "line" | "dashed" | "area" | "band" | "bar";

export interface LegendItem {
  label: string;
  /** The same class that colours the series on the chart (`band-shielded`, `flow-2`…). */
  className: string;
  mark: LegendMark;
  /** The series' ink weight: `dim` for the 0.55 steps, `faint` for 0.35, as the chart draws it. */
  weight?: "dim" | "faint";
}

export interface ChartLegendProps {
  items: LegendItem[];
}

const WEIGHT = { dim: "opacity-55", faint: "opacity-35" } as const;

/** The swatch for each mark, sized to read beside 12px text. */
const SWATCH: Record<LegendMark, string> = {
  line: "h-0.5 w-3 bg-current",
  dashed: "w-3 border-t-2 border-dashed border-current",
  area: "chart-band h-2.5 w-3 bg-current",
  band: "h-2.5 w-3 bg-current opacity-30",
  bar: "h-2.5 w-2 bg-current",
};

/**
 * Which colour is which series, beneath a chart with more than one. The hover readout names a
 * series too, but only at the point under the cursor; a legend answers before anyone hovers, and
 * on a touch screen it is the only answer.
 */
export function ChartLegend({ items }: ChartLegendProps) {
  if (items.length < 2) return null;
  return (
    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-dim">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span aria-hidden className={`inline-flex items-center ${item.className}`}>
            <span
              className={`inline-block ${SWATCH[item.mark]} ${item.weight ? WEIGHT[item.weight] : ""}`}
            />
          </span>
          {item.label}
        </li>
      ))}
    </ul>
  );
}
