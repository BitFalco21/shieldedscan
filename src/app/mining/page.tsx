import type { Metadata } from "next";
import { parseMiningWindow, type MiningWindowKey } from "@/domain";
import { getDataSource } from "@/data";
import { DataUnavailable } from "@/components/DataUnavailable";
import { MiningPage } from "@/features/mining/MiningPage";
import { isTransientUpstream } from "@/lib/transient-upstream";

/** Rolling windows ending at the tip: never serve a stale Data Cache entry. */
export const fetchCache = "force-no-store";

export const metadata: Metadata = {
  title: "Mining",
  description:
    "Zcash solution rate, difficulty, block economics and reward distribution by payout address.",
};

/**
 * No `loading.tsx` belongs above any route that can call `notFound()`: a Suspense boundary
 * commits HTTP 200 first. This route never 404s (an unrecognised window parses to the
 * default), but the rule still applies to the directory.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>;
}) {
  const params = await searchParams;
  const window = parseMiningWindow(params.window);

  // "7d" is the default, so it is omitted from the URL: an unfiltered request stays
  // byte-identical and shares one CDN cache key, the same rule the cross-chain filters follow.
  const windowHref = (key: MiningWindowKey) => (key === "7d" ? "/mining" : `/mining?window=${key}`);

  // Served by `/chain/mining`. An outage is named, never crashed on; anything else still
  // throws, so a wrong shape fails loudly instead of hiding behind a panel that looks
  // like somebody else's outage.
  let overview;
  try {
    overview = await getDataSource().getMiningOverview(window);
  } catch (error) {
    if (!isTransientUpstream(error)) throw error;
    return <DataUnavailable what="the mining overview" refreshesWithin="a minute" />;
  }

  return <MiningPage overview={overview} windowHref={windowHref} />;
}
