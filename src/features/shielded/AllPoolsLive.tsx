"use client";

import { useState } from "react";
import type { SupplyBreakdown } from "@/domain";
import { allPoolsSupply, nu7ActiveAt, shareOfIssuedPct, shareOfMaxSupplyPct } from "@/domain";
import { Panel } from "@/components/Panel";
import { network } from "@/lib/network";
import { SupplyLiveStatus } from "./SupplyLiveStatus";
import { SupplyOverview } from "./SupplyOverview";
import { SupplyPartCard } from "./SupplyPartCard";
import { SupplyPartPanel } from "./SupplyPartPanel";
import { SupplySplitBar } from "./SupplySplitBar";
import { supplyPartMeta } from "./supply-part-meta";
import { useLiveSupply } from "./useLiveSupply";

export interface AllPoolsLiveProps {
  /** The server's read, which is the whole view with scripting off. */
  initial: SupplyBreakdown;
}

const PANEL_ID = "supply-part-panel";

/**
 * Everything on the all-pools view that moves per block. One payload feeds it all, so the
 * totals, the bar and the cards always come from the same block and add up.
 */
export function AllPoolsLive({ initial }: AllPoolsLiveProps) {
  const { supply: breakdown, status } = useLiveSupply(initial);
  // Ironwood first, as the pool most readers come for.
  const [selected, setSelected] = useState("ironwood");
  const nu7Active = nu7ActiveAt(network, breakdown.height);
  const supply = allPoolsSupply(breakdown, network);
  const cards = supply.parts.map((part) => ({ part, meta: supplyPartMeta(part, nu7Active) }));
  const shown = cards.find((c) => c.part.key === selected) ?? cards[0]!;

  return (
    <>
      <SupplyLiveStatus height={supply.height} status={status} />
      <div className="mt-3">
        <SupplyOverview supply={supply} />
      </div>
      <Panel title="THE 21M ZEC, BY POOL" className="mt-3">
        <SupplySplitBar supply={supply} nu7Active={nu7Active} />
      </Panel>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(({ part, meta }) => (
          <SupplyPartCard
            key={part.key}
            part={part}
            meta={meta}
            sharePct={
              meta.denominator === "cap"
                ? part.zat === null
                  ? null
                  : shareOfMaxSupplyPct(part.zat)
                : shareOfIssuedPct(part.zat, supply.issuedZat)
            }
            selected={part.key === shown.part.key}
            onSelect={() => setSelected(part.key)}
            controls={PANEL_ID}
          />
        ))}
      </div>
      <SupplyPartPanel id={PANEL_ID} meta={shown.meta} />
    </>
  );
}
