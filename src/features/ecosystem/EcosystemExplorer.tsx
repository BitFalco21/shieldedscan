"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import type { EcosystemCategoryMeta, EcosystemEntry } from "@/domain/ecosystem";
import { EcosystemList, type EcosystemListGroup } from "./EcosystemList";
import { EcosystemStage } from "./EcosystemStage";
import { layoutEcosystem } from "./layout";
import { searchEntries } from "./search";

export interface EcosystemExplorerProps {
  categories: readonly EcosystemCategoryMeta[];
  entries: readonly EcosystemEntry[];
  logos: readonly string[];
  updatedOn: string;
}

type Mode = "auto" | "map" | "list";

const WIDE = "(min-width: 768px)";

function subscribeWide(onChange: () => void): () => void {
  const mq = typeof window !== "undefined" ? window.matchMedia?.(WIDE) : undefined;
  mq?.addEventListener("change", onChange);
  return () => mq?.removeEventListener("change", onChange);
}

function readWide(): boolean {
  return window.matchMedia?.(WIDE).matches ?? true;
}

/**
 * The map and the list, one at a time, with a switch between them.
 *
 * Before scripting runs the mode is `auto`, and CSS alone decides: the map on a wide screen,
 * the list on a phone, where a hundred-odd names round an ellipse cannot be read. Once mounted
 * the switch appears and takes the same answer as its starting point, so nothing on screen
 * changes at hydration. A reader without JavaScript keeps whichever view their screen gets,
 * and every project in it is still a link.
 */
export function EcosystemExplorer({
  categories,
  entries,
  logos,
  updatedOn,
}: EcosystemExplorerProps) {
  const wide = useSyncExternalStore(subscribeWide, readWide, () => null);
  const [chosen, setChosen] = useState<"map" | "list" | null>(null);
  // Until the reader picks, the view follows the width — exactly what the CSS was showing.
  const mode: Mode = chosen ?? (wide === null ? "auto" : wide ? "map" : "list");
  const [query, setQuery] = useState("");
  const logoSet = useMemo(() => new Set(logos), [logos]);
  const layout = useMemo(() => layoutEcosystem(categories, entries), [categories, entries]);

  const groups: EcosystemListGroup[] = useMemo(() => {
    const matched = query.trim() ? new Set(searchEntries(entries, query).map((e) => e.id)) : null;
    return layout.sectors
      .map((s) => ({
        meta: s.meta,
        slot: s.slot,
        entries: entries.filter((e) => e.category === s.meta.id && (!matched || matched.has(e.id))),
      }))
      .filter((g) => g.entries.length > 0);
  }, [layout, entries, query]);
  const shown = groups.reduce((n, g) => n + g.entries.length, 0);

  return (
    <div className="eco-explorer" data-mode={mode}>
      <div className="mb-3 flex h-8 items-center justify-between gap-4">
        {mode !== "auto" ? (
          <div role="group" aria-label="Show the ecosystem as" className="flex gap-1.5">
            {(["map", "list"] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => setChosen(m)}
                className={`microlabel cursor-pointer rounded-sm border px-3 py-1 transition-colors ${
                  mode === m
                    ? "border-edge text-green"
                    : "border-edge-faint text-ink-faint hover:text-ink-dim"
                }`}
              >
                {m === "map" ? "> map" : "> list"}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* Full-bleed on desktop: a hundred-odd labelled projects in the 1,104px column render at ~6px.
          4vw of margin keeps a scrollbar from causing sideways scroll; e2e/overflow reads the
          marker and still holds this box inside the viewport. */}
      <div
        data-full-bleed
        className="eco-map-view md:relative md:left-1/2 md:w-[min(96vw,1680px)] md:-translate-x-1/2"
      >
        <EcosystemStage layout={layout} entries={entries} logos={logoSet} updatedOn={updatedOn} />
      </div>

      <div className="eco-list-view">
        <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2">
          <input
            type="search"
            aria-label="Filter projects"
            placeholder="Filter by name, site or category"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full max-w-sm rounded-sm border border-edge bg-panel px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-edge-strong focus:outline-none"
          />
          {query.trim() ? (
            <span className="text-xs text-ink-faint" aria-live="polite">
              {shown} of {entries.length} projects
            </span>
          ) : null}
        </div>
        {shown > 0 ? (
          <EcosystemList groups={groups} logos={logoSet} />
        ) : (
          <p className="text-sm text-ink-faint">No project matches “{query.trim()}”.</p>
        )}
      </div>
    </div>
  );
}
