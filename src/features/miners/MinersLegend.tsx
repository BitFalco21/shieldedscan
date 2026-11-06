"use client";

export interface MinersLegendItem {
  key: string;
  label: string;
  className: string;
  /** The figure beside the name: a share, with its count. Omitted for a series legend. */
  value?: string;
}

export interface MinersLegendProps {
  items: MinersLegendItem[];
  highlighted: string | null;
  onHighlight: (key: string | null) => void;
  /** Grid columns from `sm`, for a legend that states a value per item. */
  columns?: 1 | 2 | 3;
}

const COLUMNS = { 1: "", 2: "sm:grid-cols-2", 3: "sm:grid-cols-2 lg:grid-cols-3" } as const;

/**
 * A legend whose items bring their band forward: pointing at one, or focusing it with the
 * keyboard, dims every other band, so a band above the bottom of a stack can be read on its own.
 * Each item is a button so focus reaches it; it toggles nothing else.
 */
export function MinersLegend({ items, highlighted, onHighlight, columns = 3 }: MinersLegendProps) {
  return (
    <ul
      className={`mt-4 grid gap-x-6 gap-y-1 ${COLUMNS[columns]}`}
      onPointerLeave={() => onHighlight(null)}
    >
      {items.map((item) => (
        <li key={item.key}>
          <button
            type="button"
            data-legend-key={item.key}
            aria-pressed={highlighted === item.key}
            onPointerEnter={() => onHighlight(item.key)}
            onFocus={() => onHighlight(item.key)}
            onBlur={() => onHighlight(null)}
            className={`flex w-full cursor-default items-baseline justify-between gap-3 rounded-xs py-0.5 text-left text-sm transition-opacity focus-visible:outline-1 focus-visible:outline-green motion-reduce:transition-none ${
              highlighted !== null && highlighted !== item.key ? "opacity-40" : ""
            }`}
          >
            <span className="flex min-w-0 items-baseline gap-2">
              <span aria-hidden className={`${item.className} text-xs`}>
                ▉
              </span>
              <span className="truncate text-ink">{item.label}</span>
            </span>
            {item.value ? (
              <span className="shrink-0 text-ink-dim tabular-nums">{item.value}</span>
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  );
}
