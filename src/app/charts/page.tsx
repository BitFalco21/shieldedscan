import type { Metadata } from "next";
import { getPrerenderedDataSource } from "@/data";
import { PageHeader } from "@/components/PageHeader";
import { CHART_CATEGORIES, VISIBLE_CHARTS, isNewChart } from "@/features/charts/catalog";
import { ChartLibrary } from "@/features/charts/ChartLibrary";
import { chartPreview } from "@/features/charts/chart-preview";
import { nowSeconds } from "@/lib/clock";
import { loadChartData } from "@/app/_shared/load-chart-data";

/**
 * Prerendered at 300 s. Every series here is day- or month-grain and its own fetch carries a
 * 300–900 s window. Declared explicitly because the build legend shows nothing for a window
 * inferred from fetches, and Next takes the minimum window across the route.
 */
export const revalidate = 300;

export const metadata: Metadata = {
  title: "Charts",
  description:
    "Every chart on shieldedscan: shielded pools, fees, activity, mining and network health, all from public chain data.",
};

/**
 * The chart library: one card per chart, with its headline figure and its shape, searchable and
 * filterable by category. The charts themselves, with their axes, readouts and prose, live on
 * each chart's own page, which keeps this page light and scannable as the library grows.
 *
 * Previews are computed here, on the server, from the same tables the charts draw, so a card
 * can never show a figure its chart does not.
 */
export default async function Page() {
  const data = await loadChartData(
    getPrerenderedDataSource(),
    VISIBLE_CHARTS.map((c) => c.slug),
  );
  const nowSec = nowSeconds();
  return (
    <>
      <PageHeader
        eyebrow="CHARTS"
        title="The chain, drawn"
        lede="Every chart on this site, all from public chain data. Nothing here estimates what the encryption protects."
      />
      <ChartLibrary
        // By category, in chip order, then catalogue order: related charts sit side by side.
        charts={[...VISIBLE_CHARTS]
          .sort(
            (a, b) => CHART_CATEGORIES.indexOf(a.category) - CHART_CATEGORIES.indexOf(b.category),
          )
          .map((c) => ({
            slug: c.slug,
            title: c.title,
            category: c.category,
            blurb: c.blurb,
            preview: chartPreview(c.slug, data, nowSec),
            isNew: isNewChart(c, nowSec),
          }))}
      />
    </>
  );
}
