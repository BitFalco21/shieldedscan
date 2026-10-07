import type { Metadata } from "next";
import { getDataSource } from "@/data";
import { nowSeconds } from "@/lib/clock";
import { MempoolPage } from "@/features/mempool/MempoolPage";
import { parsePage } from "@/lib/parse-page";

// Tip-sensitive: skip Next's fetch Data Cache (ARCHITECTURE.md, "Caching and freshness").
export const fetchCache = "force-no-store";

export const metadata: Metadata = {
  title: "Mempool",
  description: "Unconfirmed Zcash transactions waiting to be mined.",
};

export default async function Page({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { page: raw } = await searchParams;
  const page = parsePage(raw);
  const data = getDataSource();
  const [stats, { items: entries, totalPages }] = await Promise.all([
    data.getMempoolStats(),
    data.listMempool(page, 10),
  ]);
  // Wall clock, not the chain tip: "seen 40s ago" measures the node's arrival clock, and
  // the tip is routinely a minute stale — against it every fresh entry would read "0s".
  return (
    <MempoolPage
      entries={entries}
      stats={stats}
      now={nowSeconds()}
      page={Math.min(page, totalPages)}
      totalPages={totalPages}
    />
  );
}
