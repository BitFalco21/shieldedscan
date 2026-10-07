import { MAP_LENSES, type MapLens } from "./lenses";
import { formatCount } from "@/lib/format";

export interface MapLensToggleProps {
  lens: MapLens;
  onLens: (lens: MapLens) => void;
  showGhosts: boolean;
  onShowGhosts: (show: boolean) => void;
  /** Every advertised-but-never-answered address, for the checkbox's own count. */
  ghostTotal: number;
}

/**
 * Which statistic colours the map, and whether the never-answered population is drawn.
 * Buttons with `aria-pressed`, not links: a lens is a viewport over one payload already on
 * the page, so it stores nothing and navigates nowhere — the range-toggle rule.
 */
export function MapLensToggle({
  lens,
  onLens,
  showGhosts,
  onShowGhosts,
  ghostTotal,
}: MapLensToggleProps) {
  return (
    <div className="mb-3.5 flex flex-wrap items-center gap-2">
      <div
        role="group"
        aria-label="Colour the map by"
        className="flex flex-wrap items-center gap-2"
      >
        <span className="microlabel mr-1.5">lens</span>
        {MAP_LENSES.map((l) => (
          <button
            key={l.lens}
            type="button"
            aria-pressed={lens === l.lens}
            onClick={() => onLens(l.lens)}
            className={`cursor-pointer border px-2.5 py-1 text-xs ${
              lens === l.lens
                ? "border-edge text-green"
                : "border-edge-faint text-ink-dim hover:text-ink"
            }`}
          >
            {l.label}
          </button>
        ))}
      </div>
      <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs text-ink-faint">
        <input
          type="checkbox"
          className="accent-green"
          checked={showGhosts}
          onChange={(e) => onShowGhosts(e.target.checked)}
        />
        advertised, not answering · {formatCount(ghostTotal)}
      </label>
    </div>
  );
}
