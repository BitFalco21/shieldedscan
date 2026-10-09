"use client";

import { useState } from "react";
import { ChartCard, type ChartCardProps } from "./ChartCard";
import { CHART_CATEGORIES, type ChartCategory } from "./catalog";

export interface ChartLibraryProps {
  charts: ChartCardProps[];
}

/** Every word of the query must appear somewhere in what the card says. */
function matches(chart: ChartCardProps, words: string[]): boolean {
  const text = [chart.title, chart.blurb, chart.category, chart.preview.headline?.caption ?? ""]
    .join(" ")
    .toLowerCase();
  return words.every((w) => text.includes(w));
}

/**
 * The chart library: a search field, one chip per category, and the cards.
 *
 * Filtering is local: every card is already on the page, so typing costs no request, and the
 * prerendered page lists every chart for a reader or crawler without JavaScript. A category with
 * no chart on this deployment gets no chip, so no chip ever empties the grid.
 */
export function ChartLibrary({ charts }: ChartLibraryProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<ChartCategory | null>(null);

  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = charts.filter(
    (c) => (category === null || c.category === category) && matches(c, words),
  );
  const chips = CHART_CATEGORIES.filter((cat) => charts.some((c) => c.category === cat));

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="panel flex h-11 max-w-md min-w-0 flex-1 basis-80 items-center gap-2.5 px-3.5 text-sm">
          <span aria-hidden className="text-green">
            &gt;
          </span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="search charts: fees, ironwood, mining…"
            aria-label="Search charts"
            className="w-full bg-transparent text-ink placeholder:text-ink-faint"
          />
        </label>
        <span className="text-xs text-ink-faint" aria-live="polite">
          {shown.length === charts.length
            ? `${charts.length} charts`
            : `${shown.length} of ${charts.length} charts`}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Filter by category">
        {[null, ...chips].map((cat) => {
          const active = cat === category;
          return (
            <button
              key={cat ?? "all"}
              type="button"
              aria-pressed={active}
              onClick={() => setCategory(cat)}
              className={`h-8 cursor-pointer rounded-xs border px-3 text-xs transition-colors ${
                active
                  ? "border-green bg-green text-bg"
                  : "border-edge text-ink-dim hover:border-edge-strong hover:text-green"
              }`}
            >
              {cat ?? "All"}
            </button>
          );
        })}
      </div>

      {shown.length > 0 ? (
        <div className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-3">
          {shown.map((chart) => (
            <ChartCard key={chart.slug} {...chart} />
          ))}
        </div>
      ) : (
        <p className="mt-8 text-sm text-ink-faint">
          No chart matches. Try another word, or another category.
        </p>
      )}
    </div>
  );
}
