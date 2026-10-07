import type { Metadata } from "next";
import Link from "@/components/Link";
import { getPrerenderedDataSource } from "@/data";
import { Panel } from "@/components/Panel";
import { ChartFigure } from "@/features/charts/ChartFigure";
import { VISIBLE_CHARTS, CHART_GROUPS } from "@/features/charts/catalog";
import { loadChartData } from "@/app/_shared/load-chart-data";
import { PageHeader } from "@/components/PageHeader";

/**
 * Prerendered at 300 s. Every series here is day- or month-grain and its own fetch carries a
 * 300–900 s window. Declared explicitly because the build legend shows nothing for a window
 * inferred from fetches, and Next takes the minimum window across the route.
 */
export const revalidate = 300;

export const metadata: Metadata = {
  title: "Charts",
  description:
    "Every chart on shieldedscan: shielded pools, fees, activity and network health, all from public chain data.",
};

/**
 * The chart library. Each card is the real chart at gallery size — not a thumbnail image —
 * with its own hover readout, and an "open" link to the chart's page where the prose lives.
 *
 * The link is on the title row rather than wrapping the panel: the charts are interactive
 * (hover readouts, keyboard groups), and an anchor around an interactive region is both an
 * a11y violation and a click-fight. Title and arrow are the affordance; the chart is the
 * content.
 */
export default async function Page() {
  const data = await loadChartData(
    getPrerenderedDataSource(),
    VISIBLE_CHARTS.map((c) => c.slug),
  );
  return (
    <>
      <PageHeader
        eyebrow="CHARTS"
        title="The chain, drawn"
        lede="Every chart on this site, in one place. All of it is genuinely public data — counts, fees, declared pool flows and consensus figures. Nothing here estimates what the encryption protects. Open a chart for the full view and what it does and does not say."
      />

      {/* One larger step between the named groups; `mt-3` between the panels inside one. */}
      <div className="space-y-8">
        {CHART_GROUPS.map((group) => (
          <section key={group}>
            <h2 className="microlabel mb-3">{group.toUpperCase()}</h2>
            <div className="grid gap-3 lg:grid-cols-2">
              {VISIBLE_CHARTS.filter((c) => c.group === group).map((chart) => (
                <Panel key={chart.slug} className="min-w-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <Link
                      href={`/charts/${chart.slug}`}
                      className="text-sm font-semibold tracking-wide text-ink-bright hover:text-green"
                    >
                      {chart.title} <span aria-hidden>→</span>
                    </Link>
                  </div>
                  <p className="mt-0.5 mb-3 text-xs text-ink-faint">{chart.blurb}</p>
                  {/* compact: at gallery width the viewBox scales to ~0.5, so axis text is
                    drawn larger to stay readable — full-size pages keep the base ticks. */}
                  <ChartFigure slug={chart.slug} data={data} compact />
                </Panel>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
