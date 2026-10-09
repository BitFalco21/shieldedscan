"use client";

import type { ChartRange } from "@/domain";
import { CopyButton } from "@/components/CopyButton";
import { siteUrl } from "@/lib/site";
import type { ChartSlug } from "./catalog";
import type { ChartData } from "./chart-data";
import { chartCsv, chartTable } from "./chart-table";

export interface ChartActionsProps {
  slug: ChartSlug;
  data: ChartData;
  range: ChartRange;
}

/**
 * A chart page's two actions: download what is plotted, and copy a link that opens on it.
 *
 * The CSV is built in the browser from the data already on the page, for exactly the range shown:
 * nothing is fetched and nothing leaves the machine. Blob and anchor click, as `ExportJsonButton`
 * does it, with the revoke deferred a tick so it cannot cancel the download.
 */
export function ChartActions({ slug, data, range }: ChartActionsProps) {
  const table = chartTable(slug, data, range);
  const link = `${siteUrl}/charts/${slug}${range === "all" ? "" : `?range=${range}`}`;

  const download = () => {
    if (!table) return;
    const url = URL.createObjectURL(new Blob([chartCsv(table)], { type: "text/csv" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `shieldedscan-${slug}-${range}.csv`;
    anchor.style.display = "none";
    document.body.append(anchor);
    anchor.click();
    setTimeout(() => {
      anchor.remove();
      URL.revokeObjectURL(url);
    }, 0);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <button
        type="button"
        onClick={download}
        disabled={!table}
        className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-xs border border-green px-3 text-green transition-colors hover:bg-green hover:text-bg disabled:cursor-not-allowed disabled:border-edge disabled:text-ink-faint disabled:hover:bg-transparent"
      >
        <span aria-hidden>↓</span>
        csv
      </button>
      <span className="inline-flex h-8 items-center rounded-xs border border-edge px-3 text-ink-dim">
        <CopyButton value={link} label="link to this chart" withLabel />
      </span>
    </div>
  );
}
