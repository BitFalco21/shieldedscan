"use client";

import { useState } from "react";
import type { CountryCost } from "@/domain";
import { electricityMargin } from "@/domain";
import { DataTable } from "@/components/DataTable";
import { formatSharePct } from "@/lib/format";
import { formatCost, formatTariff, formatUsdExact } from "./format";

export interface CostRankingTableProps {
  /** Cheapest first — `rankCountryCosts`' order. */
  ranked: readonly CountryCost[];
  priceUsd: number | null;
  /** How many rows to show at each end. */
  ends?: number;
}

/**
 * The cheapest and most expensive countries, with the rest folded between them. The fold row
 * opens the whole list in place, cheapest first, and a "show fewer" row folds it back.
 *
 * Margin carries its denominator in the header ("of $1,007.86") rather than in every cell.
 */
export function CostRankingTable({ ranked, priceUsd, ends = 8 }: CostRankingTableProps) {
  const [expanded, setExpanded] = useState(false);
  const canFold = ranked.length > ends * 2;
  const head = expanded || !canFold ? ranked : ranked.slice(0, ends);
  const tail = expanded || !canFold ? [] : ranked.slice(-ends);
  const folded = expanded ? 0 : Math.max(0, ranked.length - head.length - tail.length);
  const max = ranked[ranked.length - 1]?.costUsd ?? 1;

  const row = (c: CountryCost) => {
    const bar = Math.max(1, Math.round((c.costUsd / max) * 14));
    return (
      <tr key={c.iso3} className="hairline-b last:border-0">
        <td>{c.name}</td>
        <td className="text-right whitespace-nowrap text-ink-dim tabular-nums">
          {formatTariff(c.tariffUsdPerKwh)}
        </td>
        <td className="text-right tabular-nums">
          {formatCost(c.costUsd)}
          {/* A bar per row, as characters rather than geometry: a width per row would be an
              inline style, and a block glyph run reads the same way at any zoom. */}
          <span aria-hidden="true" className="ml-2 text-green-dim">
            {"▮".repeat(bar)}
          </span>
        </td>
        <td className="text-right tabular-nums">
          {priceUsd === null ? "—" : formatSharePct(electricityMargin(priceUsd, c.costUsd).pct, 0)}
        </td>
      </tr>
    );
  };

  return (
    <DataTable
      caption="Electricity cost of one ZEC by country, cheapest and most expensive"
      density="compact"
      columns={[
        { label: "country" },
        { label: "tariff", align: "right" },
        { label: "electricity / ZEC", align: "right" },
        {
          label: priceUsd === null ? "margin" : `margin of ${formatUsdExact(priceUsd)}`,
          align: "right",
        },
      ]}
    >
      {head.map(row)}
      {folded > 0 ? (
        <tr className="hairline-b last:border-0">
          <td colSpan={4} className="py-1 text-center">
            <button
              type="button"
              onClick={() => setExpanded(true)}
              aria-expanded={false}
              className="microlabel cursor-pointer text-ink-dim hover:text-green"
            >
              · · · show all {ranked.length} countries · {folded} more · · ·
            </button>
          </td>
        </tr>
      ) : null}
      {tail.map(row)}
      {expanded && canFold ? (
        <tr className="hairline-b last:border-0">
          <td colSpan={4} className="py-1 text-center">
            <button
              type="button"
              onClick={() => setExpanded(false)}
              aria-expanded={true}
              className="microlabel cursor-pointer text-ink-dim hover:text-green"
            >
              · · · show fewer · · ·
            </button>
          </td>
        </tr>
      ) : null}
    </DataTable>
  );
}
