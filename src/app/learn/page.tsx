import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCachedDataSource } from "@/data";
import { LearnPage } from "@/features/learn/LearnPage";
import { pageShareMetadata } from "@/lib/share-card";
import { isTestnet } from "@/lib/network";
import { siteUrl } from "@/lib/site";
import { nullIfTransient } from "@/lib/transient-upstream";

const TITLE = "Your first shielded transaction";
const DESCRIPTION =
  "Practice with test ZEC, then make your first shielded Zcash transaction and see what the blockchain shows everyone else.";

/**
 * Rendered on request, never at build, so a deploy cannot depend on the API; the edge cache
 * (`lib/edge-cache.ts`) shares one render among readers. The only live figure is today's price,
 * used for the test exchange and for the fee's dollar value beside a real result. The real checks
 * run live through `/api/learn`.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  ...pageShareMetadata(TITLE, DESCRIPTION),
};

/**
 * Mainnet-only: the page teaches buying and moving real ZEC, and testnet coins have no exchange,
 * no price and no beginner wallet. The `notFound()` means this route can 404, so no `loading.tsx`
 * may sit above it.
 */
export default async function Page() {
  if (isTestnet) notFound();
  // A transient upstream failure costs only the dollar figures; the page works without them.
  const info = await nullIfTransient(() => getCachedDataSource().getChainInfo());
  return <LearnPage priceUsd={info?.priceUsd ?? null} pageUrl={`${siteUrl}/learn`} />;
}
