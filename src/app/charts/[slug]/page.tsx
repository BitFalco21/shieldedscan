import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPrerenderedDataSource } from "@/data";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { ChartFigure } from "@/features/charts/ChartFigure";
import { VISIBLE_CHARTS, chartBySlug } from "@/features/charts/catalog";
import { loadChartData } from "@/app/_shared/load-chart-data";

export function generateStaticParams() {
  return VISIBLE_CHARTS.map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const chart = chartBySlug((await params).slug);
  return chart
    ? { title: `${chart.title} — Charts`, description: chart.blurb }
    : { title: "Charts" };
}

/**
 * Prerendered at 3600 s. Without a route-level window, `/charts/price` would never
 * revalidate: its price map is a bare fetch carrying none. Other slugs keep their fetches'
 * shorter windows, since Next takes the minimum across the route; this is a ceiling. Declared
 * explicitly because the build legend shows nothing for a window inferred from fetches.
 */
export const revalidate = 3600;

/**
 * One chart, full width, with its frame: what is measured, from where, and the way a reader
 * is most likely to misread it. The prose lives here rather than in the gallery so the
 * gallery stays scannable.
 *
 * No loading.tsx may sit above this route: it calls notFound(), and a Suspense boundary
 * would commit a 200 before the check runs.
 */
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const chart = chartBySlug(slug);
  if (!chart) notFound();
  const data = await loadChartData(getPrerenderedDataSource(), [chart.slug]);
  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "CHARTS", href: "/charts" }, { label: chart.group.toUpperCase() }]}
        title={chart.title}
      />

      <Panel>
        <ChartFigure slug={chart.slug} data={data} />
      </Panel>

      <div className="mt-3 max-w-2xl space-y-3">
        {chart.description.map((paragraph) => (
          <p key={paragraph.slice(0, 32)} className="text-sm leading-relaxed text-ink-dim">
            {paragraph}
          </p>
        ))}
      </div>
    </>
  );
}
