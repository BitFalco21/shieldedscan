import type { Metadata } from "next";
import { getPrerenderedDataSource } from "@/data";
import { ZipsPage } from "@/features/zips/ZipsPage";
import { DataUnavailable } from "@/components/DataUnavailable";
import { nullIfTransient } from "@/lib/transient-upstream";
import type { ZipIndex } from "@/domain";

/**
 * Prerendered with an hourly revalidate: nothing here misdates on a stale render, the one
 * time-sensitive fact (asOf) is printed on the page,
 * and a reference page is exactly the kind that gets linked from elsewhere. No warmer
 * slot: the content is day-grain at its fastest.
 */
export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Zcash Improvement Proposals",
  description:
    "Every numbered ZIP — title, category and status — read from the canonical repository and linking to each proposal's page.",
};

/** `/zips` — both networks: protocol documentation is network-independent. */
export default async function Page() {
  const index: ZipIndex | null = await nullIfTransient(() =>
    getPrerenderedDataSource().getZipIndex(),
  );

  if (index === null) {
    return <DataUnavailable what="The ZIP index" refreshesWithin="an hour" />;
  }

  return <ZipsPage index={index} />;
}
