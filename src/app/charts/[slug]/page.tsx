import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCachedDataSource } from "@/data";
import { CopyButton } from "@/components/CopyButton";
import Link from "@/components/Link";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { ChartCard } from "@/features/charts/ChartCard";
import { ChartFigure } from "@/features/charts/ChartFigure";
import { chartBySlug, relatedCharts } from "@/features/charts/catalog";
import { chartPreview } from "@/features/charts/chart-preview";
import { chartCurl } from "@/features/charts/chart-curl";
import { nowSeconds } from "@/lib/clock";
import { chartDataFor, loadChartData } from "@/app/_shared/load-chart-data";

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
 * Rendered on request, never at build, so a deploy cannot depend on the API; the edge cache
 * (`lib/edge-cache.ts`) shares one render among readers. Every slug is rendered on first request;
 * an unknown one 404s.
 */
export const dynamic = "force-dynamic";

/**
 * One chart, full width, with its frame: what is measured, from where, and the way a reader
 * is most likely to misread it. Then where to fetch the same data, and what to read next.
 *
 * The range is read from `?range=` on the client (`ChartFigure detail`), so one cached render
 * serves every range while a shared link still opens on the range its sender chose.
 *
 * No loading.tsx may sit above this route: it calls notFound(), and a Suspense boundary
 * would commit a 200 before the check runs.
 */
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const chart = chartBySlug(slug);
  if (!chart) notFound();
  const related = relatedCharts(chart.slug);
  const data = await loadChartData(getCachedDataSource(), [
    chart.slug,
    ...related.map((c) => c.slug),
  ]);
  const nowSec = nowSeconds();
  const curl = chartCurl(chart);
  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "CHARTS", href: "/charts" }, { label: chart.category.toUpperCase() }]}
        title={chart.title}
      />

      <Panel>
        <ChartFigure slug={chart.slug} data={chartDataFor(chart.slug, data)} detail />
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
        {chart.api && curl ? (
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
            <div className="mt-2 flex items-center gap-3 rounded-xs border border-edge-faint bg-bg px-3 py-2">
              <code className="min-w-0 flex-1 overflow-x-auto text-xs whitespace-nowrap text-ink">
                {curl}
              </code>
              <CopyButton value={curl} label="curl command" withLabel />
            </div>
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
