import type { Metadata } from "next";
import { getCachedDataSource } from "@/data";
import { ZipsPage } from "@/features/zips/ZipsPage";
import { DataUnavailable } from "@/components/DataUnavailable";
import { nullIfTransient } from "@/lib/transient-upstream";
import type { ZipIndex } from "@/domain";

/**
 * Rendered on request, never at build, so a deploy cannot depend on the API; the edge cache
 * (`lib/edge-cache.ts`) shares one render among readers. Nothing here misdates on a stale render:
 * the one time-sensitive fact (asOf) is printed on the page.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Zcash Improvement Proposals",
  description:
    "Every numbered ZIP — title, category and status — read from the canonical repository and linking to each proposal's page.",
};

/** `/zips` — both networks: protocol documentation is network-independent. */
export default async function Page() {
  const index: ZipIndex | null = await nullIfTransient(() => getCachedDataSource().getZipIndex());

  if (index === null) {
    return <DataUnavailable what="The ZIP index" refreshesWithin="an hour" />;
  }

  return <ZipsPage index={index} />;
}
