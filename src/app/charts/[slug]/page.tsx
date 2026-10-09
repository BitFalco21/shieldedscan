import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPrerenderedDataSource } from "@/data";
import Link from "@/components/Link";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { ChartCard } from "@/features/charts/ChartCard";
import { ChartFigure } from "@/features/charts/ChartFigure";
import { VISIBLE_CHARTS, chartBySlug, relatedCharts } from "@/features/charts/catalog";
import { chartPreview } from "@/features/charts/chart-preview";
import { nowSeconds } from "@/lib/clock";
import { loadChartData } from "@/app/_shared/load-chart-data";
import { apiBaseUrl } from "@/lib/site";

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
 * is most likely to misread it. Then where to fetch the same data, and what to read next.
 *
 * The range is read from `?range=` on the client (`ChartFigure detail`), so the page stays
 * prerendered while a shared link still opens on the range its sender chose.
 *
 * No loading.tsx may sit above this route: it calls notFound(), and a Suspense boundary
 * would commit a 200 before the check runs.
 */
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const chart = chartBySlug(slug);
  if (!chart) notFound();
  const related = relatedCharts(chart.slug);
  const data = await loadChartData(getPrerenderedDataSource(), [
    chart.slug,
    ...related.map((c) => c.slug),
  ]);
  const nowSec = nowSeconds();
  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "CHARTS", href: "/charts" }, { label: chart.category.toUpperCase() }]}
        title={chart.title}
      />

      <Panel>
        <ChartFigure slug={chart.slug} data={data} detail />
      </Panel>

      <div className="mt-3 max-w-2xl space-y-3">
        {chart.description.map((paragraph) => (
          <p key={paragraph.slice(0, 32)} className="text-sm leading-relaxed text-ink-dim">
            {paragraph}
          </p>
        ))}
      </div>

      <Panel className="mt-6">
        <h2 className="microlabel mb-2">Get this data</h2>
        {chart.api ? (
          <>
            <p className="text-sm text-ink-dim">
              Keyless, from the public API:{" "}
              <Link
                href={`/api-docs#${chart.api.docsId}`}
                className="text-green hover:text-ink-bright"
              >
                GET {chart.api.path}
              </Link>
            </p>
            <pre className="mt-2 overflow-x-auto rounded-xs border border-edge-faint bg-bg px-3 py-2 text-xs text-ink">
              {`curl "${apiBaseUrl}${chart.api.path}"`}
            </pre>
          </>
        ) : (
          <p className="text-sm text-ink-dim">
            Not in the public API yet. The CSV above holds every point drawn.
          </p>
        )}
      </Panel>

      {related.length > 0 && (
        <section className="mt-6">
          <h2 className="microlabel mb-3">Related charts</h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-3">
            {related.map((c) => (
              <ChartCard
                key={c.slug}
                slug={c.slug}
                title={c.title}
                category={c.category}
                blurb={c.blurb}
                preview={chartPreview(c.slug, data, nowSec)}
              />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
