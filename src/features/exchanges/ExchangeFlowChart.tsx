"use client";

import type { ExchangeFlowPeriod, ExchangeId } from "@/domain";
import { utcDayFromSeconds } from "@/domain/time";
import { FlowBalanceChart } from "@/components/FlowBalanceChart";
import { useElementWidth } from "@/lib/use-element-width";
import { formatZecAmount, formatZecTick } from "@/lib/format";

export interface ExchangeFlowChartProps {
  points: ExchangeFlowPeriod[];
  interval: "day" | "month";
  /** One exchange, or null for all of them as one (moves between them left out). */
  exchange: ExchangeId | null;
}

/**
 * ZEC into and out of the exchanges per day or month, both directions on one scale, so a quiet
 * net never hides the volume that moved. Periods an exchange is not counted for are left out.
 */
export function ExchangeFlowChart({ points, interval, exchange }: ExchangeFlowChartProps) {
  // Measured, so the ticks stay readable on a phone instead of shrinking with the frame.
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const rows = points.flatMap((p) => {
    const f = exchange === null ? p.all : p.exchanges[exchange];
    if (f === null) return [];
    const day = utcDayFromSeconds(p.timestamp);
    return [
      {
        label: interval === "month" ? day.slice(0, 7) : day.slice(5),
        readout: interval === "month" ? day.slice(0, 7) : day,
        inValue: f.inZat,
        outValue: f.outZat,
      },
    ];
  });
  if (rows.length === 0) return <p className="text-sm text-ink-faint">Nothing counted yet.</p>;
  return (
    <div ref={ref}>
      <FlowBalanceChart
        points={rows}
        ariaLabel="ZEC into and out of the exchanges' labelled addresses"
        inLabel="In"
        outLabel="Out"
        formatValue={(zat) => `${formatZecAmount(zat)} ZEC`}
        formatTick={formatZecTick}
        readoutLabels={rows.map((r) => r.readout)}
        renderedWidth={width}
      />
    </div>
  );
}
