import type { Metadata } from "next";
import { getDataSource } from "@/data";
import { cursorNavHrefs } from "@/app/_shared/cursor-nav";
import { RichListPage } from "@/features/rich-list/RichListPage";
import { nullIfTransient } from "@/lib/transient-upstream";

// Tip-sensitive: skip Next's fetch Data Cache (ARCHITECTURE.md, "Caching and freshness").
export const fetchCache = "force-no-store";

export const metadata: Metadata = {
  title: "Rich List",
  description: "Every transparent Zcash address holding ZEC, largest first.",
};

const PAGE_SIZE = 50;

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ before?: string; after?: string }>;
}) {
  const { before, after } = await searchParams;
  const data = getDataSource();
  const [page, summary, priceUsd] = await Promise.all([
    data.listRichList({ before, after, limit: PAGE_SIZE }),
    data.getRichListSummary(),
    // The dollar column is a convenience beside the fact, so an unreadable price costs the
    // column and not the page. Only a transient failure is swallowed: a shape error still
    // propagates, so the version-skew tripwire keeps failing the build.
    nullIfTransient(() => data.getChainInfo().then((info) => info.priceUsd)),
  ]);

  return (
    <RichListPage
      entries={page.items}
      summary={summary}
      priceUsd={priceUsd}
      {...cursorNavHrefs(page, (step) =>
        step
          ? `/rich-list?${new URLSearchParams({ [step.name]: step.value }).toString()}`
          : "/rich-list",
      )}
    />
  );
}
