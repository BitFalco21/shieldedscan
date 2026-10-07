import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPrerenderedDataSource } from "@/data";
import { PulsePage } from "@/features/pulse/PulsePage";
import { isTestnet } from "@/lib/network";

/**
 * Prerendered with a short revalidate, with a live layer polling on top. Frame 0 is a real
 * render (boxes, ribbons, ledger rows) so a reader without JavaScript still gets the ledger,
 * and every figure prints the block it was read at, so a cached copy's staleness is visible.
 *
 * `freshness-config.test.ts` pins this classification explicitly; it scans source text,
 * comments included, so the query-parameter prop name must not appear in this file.
 *
 * Never put a `loading.tsx` above it: its Suspense boundary commits the status before the page
 * runs, so `notFound()` would render behind an HTTP 200.
 */
export const revalidate = 60;

export const metadata: Metadata = {
  title: "The ledger",
  description:
    "Zcash as stock and flow: what each pool holds, what crossed between them, and every movement as it confirms.",
};

export default async function Page() {
  // Absent on testnet rather than empty. The API serves no pulse routes there either, so
  // neither guard is load-bearing alone.
  if (isTestnet) notFound();
  const data = getPrerenderedDataSource();
  // The frame is one call for the whole stage; the ribbons are a day-grained aggregate. The
  // mempool is not read here: prerendering it would bake a stale snapshot into a cached page.
  const [frame, ribbons] = await Promise.all([data.getPulseFrame(), data.getPulseRibbons()]);
  return <PulsePage frame={frame} ribbons={ribbons} />;
}
