"use client";

import { REISSUANCE_START_HEIGHT } from "@/domain";
import { ChartLegend } from "@/components/ChartLegend";
import { IssuanceChart } from "@/components/IssuanceChart";
import { Unmeasured } from "@/components/Unmeasured";
import { formatCount, formatZecWhole } from "@/lib/format";
import { useElementWidth } from "@/lib/use-element-width";
import type { IssuanceSnapshot } from "./issuance-snapshot";

export interface IssuancePanelProps {
  snapshot: IssuanceSnapshot;
  /**
   * Whether to state the daily rate. Off on `/halving`, which states it already beside the next
   * halving's rate, so one figure has one place on the page.
   */
  perDay?: boolean;
}

function Figure({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="microlabel text-ink-faint">{label}</dt>
      <dd className="mt-1 font-mono text-lg whitespace-nowrap text-ink-bright tabular-nums">
        {children}
      </dd>
    </div>
  );
}

/**
 * Issued ZEC: where it stands, what is left to the cap, the daily pace, and the curve to 2040.
 *
 * Issued is the live supply (pools plus the NSM) at the block it was read at. The daily figure is
 * an estimate and says so; the chart's projected half carries estimated dates, never heights.
 */
export function IssuancePanel({ snapshot, perDay = true }: IssuancePanelProps) {
  const [chartRef, chartWidth] = useElementWidth<HTMLDivElement>();
  const { issued, remainingZat, perDayZat, measured, outlook, now } = snapshot;
  return (
    <div>
      <dl
        className={
          perDay ? "grid gap-x-8 gap-y-3 sm:grid-cols-3" : "grid gap-x-8 gap-y-3 sm:grid-cols-2"
        }
      >
        <Figure label="Issued supply">
          {issued ? formatZecWhole(issued.zat) : <Unmeasured />}
        </Figure>
        <Figure label="Left to the 21M cap">
          {remainingZat !== null ? formatZecWhole(remainingZat) : <Unmeasured />}
        </Figure>
        {perDay ? <Figure label="Issued per day">≈ {formatZecWhole(perDayZat)}</Figure> : null}
      </dl>
      {issued || perDay ? (
        <p className="mt-2 text-xs text-ink-faint">
          {issued ? `Issued as of block ${formatCount(issued.height)}. ` : null}
          {perDay
            ? `Per day is an estimate at the ${measured ? "observed" : "target"} block rate; fees are not issuance.`
            : null}
        </p>
      ) : null}
      <div ref={chartRef} className="mt-4">
        <IssuanceChart
          outlook={outlook}
          now={now}
          renderedWidth={chartWidth}
          ariaLabel="ZEC issued over time, observed to now and projected by the schedule to the sixth halving, against the 21 million cap"
        />
      </div>
      <ChartLegend
        items={[
          { label: "Issued", className: "text-series", mark: "line" },
          { label: "Projected", className: "text-series", mark: "dashed" },
        ]}
      />
      <p className="mt-2 text-xs leading-relaxed text-ink-faint">
        Solid: issued at each day&apos;s closing block. Dashed: the schedule ahead, dated at the
        observed block rate, so every date is an estimate. From block{" "}
        {formatCount(REISSUANCE_START_HEIGHT)} blocks also pay out part of the NSM balance; that ZEC
        is already counted here, so the total is unchanged.
      </p>
    </div>
  );
}
