import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCachedDataSource } from "@/data";
import { MiningCostPage } from "@/features/mining-cost/MiningCostPage";
import { ELECTRICITY_TARIFFS, TARIFF_VALIDATION } from "@/data/electricity";
import { isTestnet } from "@/lib/network";

/**
 * Rendered on request, never at build, so a deploy cannot depend on the API; the edge cache
 * (`lib/edge-cache.ts`) shares one render among readers. Nothing here misdates on a stale render:
 * the height the terms were read at is printed beside them, and the tariffs ship with the page.
 *
 * It reads no query parameter, so `freshness-config.test.ts` cannot discover it by scanning; the
 * classification is pinned by its own test. The word that scan greps for must not appear in this
 * file.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Cost to mine one ZEC",
  description:
    "The electricity cost of mining one ZEC in every country, at the newest Equihash ASIC and each country's published tariff, on a world map.",
};

export default async function Page() {
  // TAZ has no market and no miner prices a tariff against it, so the page is absent rather
  // than empty on testnet, as `/stats` and `/compare` are.
  if (isTestnet) notFound();
  const terms = await getCachedDataSource().getMiningTerms();
  return (
    <MiningCostPage terms={terms} tariffs={ELECTRICITY_TARIFFS} validation={TARIFF_VALIDATION} />
  );
}
