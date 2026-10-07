"use client";

import { useState } from "react";
import type { MiningHardware, MiningTerms } from "@/domain";
import {
  breakEvenTariffUsdPerKwh,
  electricityCostUsd,
  electricityMargin,
  kwhPerZec,
  machinePerDay,
} from "@/domain";
import { formatCount, formatSharePct } from "@/lib/format";
import { formatCost, formatUsdExact } from "./format";

export interface TariffCalculatorProps {
  terms: MiningTerms;
  hardware: MiningHardware;
}

/**
 * The reader's own tariff against the same arithmetic the map uses.
 *
 * Nothing is sent and nothing is stored: the input lives in React state and the four
 * outputs are pure functions of it and of the terms the page already carries. `e2e` proves
 * the page reaches no origin but its own and writes no storage.
 */
export function TariffCalculator({ terms, hardware }: TariffCalculatorProps) {
  const [raw, setRaw] = useState("0.12");
  const tariff = Number.parseFloat(raw.replace(",", "."));
  const valid = Number.isFinite(tariff) && tariff >= 0;
  const kwh = kwhPerZec(terms, hardware);
  const day = machinePerDay(terms, hardware);
  const cost = valid && kwh !== null ? electricityCostUsd(tariff, kwh) : null;
  const margin =
    cost !== null && terms.priceUsd !== null ? electricityMargin(terms.priceUsd, cost) : null;
  const breakEven = breakEvenTariffUsdPerKwh(terms.priceUsd, kwh);

  return (
    <div className="grid gap-4">
      <label className="grid min-w-0 gap-1.5">
        <span className="text-xs text-ink-dim">electricity price you pay, USD per kWh</span>
        <span className="cost-prompt min-w-0">
          <span className="text-green" aria-hidden="true">
            zcash&gt;
          </span>
          <input
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            inputMode="decimal"
            aria-label="Your electricity price in US dollars per kilowatt-hour"
            className="w-full min-w-0 flex-1 bg-transparent text-base text-ink-bright outline-none"
          />
        </span>
      </label>

      <dl className="grid gap-2" aria-label="Your tariff, priced">
        <Row label="electricity for one ZEC" value={cost === null ? "—" : formatCost(cost)} />
        <Row
          label={terms.priceUsd === null ? "margin" : `margin at ${formatUsdExact(terms.priceUsd)}`}
          value={margin === null ? "—" : formatSharePct(margin.pct)}
          tone={margin === null ? undefined : margin.pct < 0 ? "neg" : "pos"}
        />
        <Row
          label={`one ${hardware.name}, per day`}
          value={
            day === null
              ? "—"
              : `${day.zec.toFixed(4)} ZEC${
                  terms.priceUsd === null ? "" : ` ≈ ${formatUsdExact(day.zec * terms.priceUsd)}`
                }`
          }
        />
        <Row
          label="its daily electricity bill"
          value={day === null || !valid ? "—" : formatUsdExact(day.kwh * tariff)}
        />
      </dl>

      <p className="text-xs leading-relaxed text-ink-faint">
        {day === null ? null : (
          <>
            One {hardware.name} is {formatSharePct(day.shareOfNetwork * 100, 4)}
            {" of the network, so "}
            it earns that share of every block&apos;s {(terms.minerSubsidyZat / 1e8).toFixed(5)} ZEC
            miner subsidy.{" "}
          </>
        )}
        {breakEven === null
          ? "With no price, there is no break-even to state."
          : `Above $${breakEven.toFixed(3)} per kWh the electricity costs more than the ZEC it mines.`}{" "}
        After block {formatCount(terms.subsidyChangesAtHeight)} the subsidy changes and every figure
        here moves with it.
      </p>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "pos" | "neg" }) {
  return (
    <div className="hairline-b flex items-baseline justify-between gap-4 pb-2">
      <dt className="text-xs text-ink-dim">{label}</dt>
      <dd
        className={`font-mono tabular-nums ${
          tone === "pos" ? "text-green" : tone === "neg" ? "text-red" : "text-ink-bright"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
