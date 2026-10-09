import Link from "@/components/Link";
import { ChartThumbnail } from "@/components/ChartThumbnail";
import { Unmeasured } from "@/components/Unmeasured";
import type { ChartCategory, ChartSlug } from "./catalog";
import type { ChartPreview } from "./chart-preview";

export interface ChartCardProps {
  slug: ChartSlug;
  title: string;
  category: ChartCategory;
  blurb: string;
  preview: ChartPreview;
  /** Joined the library recently: marked so a returning reader finds what is new. */
  isNew?: boolean;
}

/**
 * One chart in the library: what it is, its headline figure where one exists, and the chart in
 * miniature, in its own form and colours. The whole card is the link, because nothing inside it
 * is interactive.
 *
 * A chart with no single honest figure shows its one-line description instead, and a chart whose
 * series could not be read says "unavailable" rather than drawing nothing.
 */
export function ChartCard({
  slug,
  title,
  category,
  blurb,
  preview,
  isNew = false,
}: ChartCardProps) {
  return (
    <Link
      href={`/charts/${slug}`}
      className="panel flex min-w-0 flex-col gap-1.5 px-4 py-3.5 transition-colors hover:border-edge-strong"
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className="microlabel">{category}</span>
        {isNew && <span className="microlabel text-green">new</span>}
      </span>
      <span className="text-sm font-semibold text-ink-bright">{title}</span>
      {preview.headline ? (
        <>
          <span className="text-xl font-bold text-green">{preview.headline.value}</span>
          <span className="text-xs text-ink-faint">{preview.headline.caption}</span>
        </>
      ) : (
        <span className="text-xs text-ink-faint">{blurb}</span>
      )}
      <span className="mt-auto pt-2">
        {preview.thumb ? (
          <ChartThumbnail thumb={preview.thumb} className="h-12" />
        ) : (
          <span className="text-xs">
            <Unmeasured />
          </span>
        )}
      </span>
    </Link>
  );
}
