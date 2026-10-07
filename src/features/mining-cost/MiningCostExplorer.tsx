"use client";

import { useMemo, useState } from "react";
import type {
  CountryCost,
  ElectricityTariffs,
  MiningHardware,
  MiningTerms,
  TariffBand,
} from "@/domain";
import { COST_TIER_EDGES_USD, electricityMargin, rankCountryCosts } from "@/domain";
import { Panel } from "@/components/Panel";
import { formatSharePct } from "@/lib/format";
import { CostRankingTable } from "./CostRankingTable";
import { formatCost, formatTariff, formatUsdExact } from "./format";
import { TariffCalculator } from "./TariffCalculator";
import { WorldCostMap } from "./WorldCostMap";

export interface MiningCostExplorerProps {
  tariffs: ElectricityTariffs;
  terms: MiningTerms;
  hardware: MiningHardware;
  /** Kilowatt-hours per ZEC at these terms and this machine — computed once, on the server. */
  kwhPerZec: number;
}

const BANDS: { value: TariffBand; label: string }[] = [
  { value: "business", label: "business · 1 GWh/yr" },
  { value: "household", label: "household" },
];

/**
 * The band toggle, the map, the readout, the ranking and the calculator — everything on the
 * page that changes without a navigation.
 *
 * The band is client state, not a URL: the whole dataset is on the page and switching band
 * re-reads a column. Business is the default because the venue's 1 GWh/year band is the shape
 * of a small mining farm; household ("could I mine at home") is one click away.
 */
export function MiningCostExplorer({
  tariffs,
  terms,
  hardware,
  kwhPerZec,
}: MiningCostExplorerProps) {
  const [band, setBand] = useState<TariffBand>("business");
  const [focused, setFocused] = useState<string | null>(null);

  const ranked = useMemo(
    () => rankCountryCosts(tariffs, band, kwhPerZec),
    [tariffs, band, kwhPerZec],
  );
  const costs = useMemo(() => new Map(ranked.map((c) => [c.iso3, c])), [ranked]);
  const focusedRow =
    focused === null ? null : (tariffs.rows.find((r) => r.iso3 === focused) ?? null);
  const focusedCost: CountryCost | null = focused === null ? null : (costs.get(focused) ?? null);
  const [lo, hi] = [ranked[0], ranked[ranked.length - 1]];

  return (
    <div className="grid min-w-0 gap-3">
      <Panel
        className="min-w-0"
        title="electricity for one ZEC"
        action={
          <div role="group" aria-label="Tariff band" className="flex flex-wrap gap-1.5">
            {BANDS.map((b) => (
              <button
                key={b.value}
                type="button"
                aria-pressed={band === b.value}
                onClick={() => setBand(b.value)}
                className={`microlabel cursor-pointer rounded-sm border px-2 py-0.5 ${
                  band === b.value
                    ? "border-edge text-green"
                    : "border-edge-faint text-ink-faint hover:text-ink-dim"
                }`}
              >
                {b.label}
              </button>
            ))}
          </div>
        }
      >
        {lo && hi ? (
          <p className="mb-3 text-sm text-ink-dim">
            At the {band} tariff, from{" "}
            <b className="font-medium text-ink">{formatCost(lo.costUsd)}</b> in {lo.name} to{" "}
            <b className="font-medium text-ink">{formatCost(hi.costUsd)}</b> in {hi.name}, across{" "}
            {ranked.length} countries.
          </p>
        ) : null}

        <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_16rem]">
          <WorldCostMap costs={costs} onFocus={setFocused} />

          {/*
           * A fixed readout beside the map, not a pointer-following tooltip: that would need a
           * runtime `left`/`top` inline style, and a fixed panel also reads better on a phone,
           * where there is no hover and the finger covers the country.
           */}
          <div className="panel px-4 py-3 text-sm" role="status" aria-live="polite">
            {focusedRow === null ? (
              <p className="text-ink-faint">
                Hover or focus a country for its tariff and its cost. Dashed land publishes no
                tariff in this dataset.
              </p>
            ) : (
              <dl className="grid gap-1.5">
                <dt className="microlabel text-green">{focusedRow.name}</dt>
                <Row
                  label="business tariff"
                  value={
                    focusedRow.businessUsdKwh === null
                      ? "not published"
                      : formatTariff(focusedRow.businessUsdKwh)
                  }
                />
                <Row
                  label="household tariff"
                  value={
                    focusedRow.householdUsdKwh === null
                      ? "not published"
                      : formatTariff(focusedRow.householdUsdKwh)
                  }
                />
                <Row
                  label={`electricity / ZEC · ${band}`}
                  value={focusedCost === null ? "not published" : formatCost(focusedCost.costUsd)}
                />
                {focusedCost !== null && terms.priceUsd !== null ? (
                  <Row
                    label={`margin of ${formatUsdExact(terms.priceUsd)}`}
                    value={formatSharePct(
                      electricityMargin(terms.priceUsd, focusedCost.costUsd).pct,
                      0,
                    )}
                  />
                ) : null}
              </dl>
            )}
          </div>
        </div>

        <ul
          className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-dim"
          aria-label="Map legend"
        >
          <Legend tier={1} label={`< $${COST_TIER_EDGES_USD[0]}`} />
          <Legend tier={2} label={`$${COST_TIER_EDGES_USD[0]}–${COST_TIER_EDGES_USD[1]}`} />
          <Legend tier={3} label={`$${COST_TIER_EDGES_USD[1]}–${COST_TIER_EDGES_USD[2]}`} />
          <Legend tier={4} label={`$${COST_TIER_EDGES_USD[2]}–${COST_TIER_EDGES_USD[3]}`} />
          <Legend tier={5} label={`> $${COST_TIER_EDGES_USD[3]}`} />
          <Legend tier="none" label="no published tariff" />
        </ul>
      </Panel>

      <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {/* `min-w-0` on every panel: a grid item's automatic minimum is its content's
            min-content width, so a table or SVG inside would otherwise widen the column past
            a phone screen. */}
        <Panel title="cheapest and most expensive" className="min-w-0">
          <CostRankingTable ranked={ranked} priceUsd={terms.priceUsd} />
        </Panel>
        <Panel
          className="min-w-0"
          title="your tariff"
          action={<span className="microlabel">nothing sent · nothing stored</span>}
        >
          <TariffCalculator terms={terms} hardware={hardware} />
        </Panel>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs text-ink-dim">{label}</dt>
      <dd className="text-ink-bright tabular-nums">{value}</dd>
    </div>
  );
}

function Legend({ tier, label }: { tier: 1 | 2 | 3 | 4 | 5 | "none"; label: string }) {
  return (
    <li className="flex items-center gap-1.5">
      <span aria-hidden="true" className={`cost-swatch cost-tier-${tier}`} />
      {label}
    </li>
  );
}
