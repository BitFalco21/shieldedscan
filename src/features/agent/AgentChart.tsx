"use client";

import { useId, useState } from "react";
import { chartCaption, chartCaveats, chartSeries, type PlottedChart } from "@/domain";
import Link from "@/components/Link";
import { ChartLegend } from "@/components/ChartLegend";
import { MultiLineChart } from "@/components/MultiLineChart";
import { formatCount } from "@/lib/format";
import { formatPlotLogTick, formatPlotTick, formatPlotValue } from "@/lib/plot-format";
import { useElementWidth } from "@/lib/use-element-width";
import { AgentChartTable } from "./AgentChartTable";
import { axisLabel, chartLinks, readoutLabel, seriesDotted, seriesInks } from "./chart-view";

export interface AgentChartProps {
  chart: PlottedChart;
}

/**
 * A chart in Zeno's answer, drawn with the site's own line chart, inks and formatters. Everything
 * on it comes from the `chart` event: catalogue ids and the values the server read. The caption
 * says exactly what is plotted, the table states every value, and each series' `/charts` page is
 * one click away.
 */
export function AgentChart({ chart }: AgentChartProps) {
  const [tableOpen, setTableOpen] = useState(false);
  const tableId = useId();
  const series = chartSeries(chart);
  const unit = series[0]!.unit;
  const inks = seriesInks(series);
  const dotted = seriesDotted(series);
  const caption = chartCaption(chart);
  // The console column is narrower than a /charts page at every width (~320-710px), so the ticks
  // are sized from the width the chart is drawn at rather than from a fixed frame.
  const [chartRef, chartWidth] = useElementWidth<HTMLDivElement>();

  return (
    <figure className="mt-4 border border-edge-faint p-3">
      <div ref={chartRef}>
        <MultiLineChart
          renderedWidth={chartWidth}
          labels={chart.timestamps.map((t) => axisLabel(chart.grain, t))}
          readoutLabels={chart.timestamps.map((t) => readoutLabel(chart.grain, t))}
          series={chart.series.map((s, i) => ({
            name: series[i]!.label,
            values: s.values,
            className: inks[i]!,
            dotted: dotted[i]!,
            // A pool before it existed is absent from the readout, not "—" (see `omitLeadingZeros`).
            omitNullFromReadout: series[i]!.omitLeadingZeros === true,
          }))}
          // A floor is not a quantity on the scale, so it rides in the readout beside its value.
          contextRows={chart.series.flatMap((s, i) => [
            ...(s.floors.length === 0
              ? []
              : [
                  {
                    // Its own name: the readout keys rows by name, and the series row has the label.
                    name: `${series[i]!.label} coverage`,
                    values: chart.timestamps.map((_, k) =>
                      s.floors.includes(k) ? "a floor: some fees unread" : null,
                    ),
                  },
                ]),
            // A share names its denominator beside it (the month's blocks).
            ...(s.of === undefined
              ? []
              : [
                  {
                    name: `${series[i]!.label}, of`,
                    values: s.of.map((n) => (n === null ? null : `${formatCount(n)} blocks`)),
                  },
                ]),
          ])}
          formatValue={(v) => formatPlotValue(unit, v)}
          formatTick={(v) =>
            chart.scale === "log" ? formatPlotLogTick(unit, v) : formatPlotTick(unit, v)
          }
          ariaLabel={caption}
          scale={chart.scale}
          fill={chart.type === "area"}
          // A share is out of 100 whatever this window's high, as on /charts.
          {...(series[0]!.yMax === undefined ? {} : { yMax: series[0]!.yMax })}
        />
      </div>
      <ChartLegend
        items={series.map((s, i) => ({
          label: s.label,
          className: inks[i]!,
          // The swatch carries the dots too, or the second channel could not be decoded.
          mark: dotted[i] ? "dotted" : chart.type === "area" ? "area" : "line",
        }))}
      />
      <figcaption className="mt-3 border-t border-edge-faint pt-2 text-xs text-ink-dim">
        Plotted: {/* A date wraps whole, never at its hyphens ("2026-10-" then "02" on a phone). */}
        {caption.split(/(\d{4}-\d{2}-\d{2})/).map((part, i) =>
          i % 2 === 1 ? (
            <span key={i} className="whitespace-nowrap">
              {part}
            </span>
          ) : (
            part
          ),
        )}
        .
        {chartCaveats(chart).map((caveat) => (
          <span key={caveat}> {caveat}</span>
        ))}
      </figcaption>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
        <button
          type="button"
          aria-expanded={tableOpen}
          aria-controls={tableId}
          onClick={() => setTableOpen((o) => !o)}
          className="cursor-pointer text-green hover:underline"
        >
          {tableOpen ? "hide table" : "show table"}
        </button>
        {chartLinks(chart).map((link) => (
          // A new tab, as the sources open: the conversation lives only in this tab.
          <Link
            key={link.href}
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            prefetch={false}
            className="text-green hover:underline"
          >
            <span aria-hidden>↗ </span>
            {link.label}
          </Link>
        ))}
      </div>
      {/* Mounted only when open: a year of rows is not built for a reader who never asks. The
          wrapper stays so `aria-controls` always points at an element. */}
      <div id={tableId} hidden={!tableOpen}>
        {tableOpen && <AgentChartTable chart={chart} caption={caption} />}
      </div>
      <p className="mt-2 flex flex-wrap items-baseline gap-x-2 text-xs text-ink-faint">
        <span className="border border-edge px-1 tracking-wider text-ink-dim uppercase">beta</span>
        <span>Zeno picked the series; every number is this site&apos;s data.</span>
      </p>
    </figure>
  );
}
