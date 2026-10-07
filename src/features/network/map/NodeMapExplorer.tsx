"use client";

import { useEffect, useMemo, useState } from "react";
import type { NetMap, NetMapCell, NetSummary } from "@/domain";
import { CountryTable } from "./CountryTable";
import { asnRanking, type MapLens } from "./lenses";
import { MapLensToggle } from "./MapLensToggle";
import { MapReadout } from "./MapReadout";
import { NodeMap } from "./NodeMap";

export interface NodeMapExplorerProps {
  map: NetMap;
  summary: NetSummary;
}

/**
 * The map tab: lens, ghost toggle, the map, its readout and the country list. All client state
 * over one payload: switching lens re-asks nothing and stores nothing.
 *
 * Hover focuses a cell; a click pins it so the readout holds still while a reader compares cells
 * or reaches for it on a phone; Escape or a second click releases.
 */
export function NodeMapExplorer({ map, summary }: NodeMapExplorerProps) {
  const [lens, setLens] = useState<MapLens>("client");
  const [showGhosts, setShowGhosts] = useState(true);
  const [hovered, setHovered] = useState<NetMapCell | null>(null);
  const [pinned, setPinned] = useState<NetMapCell | null>(null);
  const ranking = useMemo(() => asnRanking(map), [map]);
  const focused = pinned ?? hovered;

  // Escape releases a pin, listened for on the window: a pointer click pins without moving
  // focus (the map refuses focus on mousedown), so the key lands on <body>.
  useEffect(() => {
    if (pinned === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPinned(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pinned]);

  return (
    <div className="min-w-0">
      <MapLensToggle
        lens={lens}
        onLens={setLens}
        showGhosts={showGhosts}
        onShowGhosts={setShowGhosts}
        ghostTotal={map.ghostTotal}
      />
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <NodeMap
          map={map}
          lens={lens}
          ranking={ranking}
          showGhosts={showGhosts}
          focused={focused}
          onFocus={setHovered}
          onPin={(cell) => setPinned((p) => (p === cell ? null : cell))}
        />
        <MapReadout
          map={map}
          summary={summary}
          lens={lens}
          ranking={ranking}
          focused={focused}
          pinned={pinned !== null}
        />
      </div>
      <CountryTable map={map} total={summary.reachable} />
    </div>
  );
}
