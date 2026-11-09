import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCachedDataSource } from "@/data";
import { SoftwarePage } from "@/features/network/software/SoftwarePage";
import { isTestnet } from "@/lib/network";
import { readNetworkShell } from "../shell-data";
import { NetworkTabPage } from "../NetworkTabPage";
import { networkShareMetadata } from "@/features/network/net-share";
import { nullIfTransient } from "@/lib/transient-upstream";

/**
 * Rendered on request, never at build, so a deploy cannot depend on the API; the edge cache
 * (`lib/edge-cache.ts`) shares one render among readers. See the map route for why a cached copy is
 * safe.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Node software",
  description:
    "Which implementations the Zcash network's answering nodes run, how each answers a crawl, and which releases and protocol versions they declare.",
  ...networkShareMetadata("software"),
};

export default async function Page() {
  if (isTestnet) notFound();
  const data = getCachedDataSource();
  const [shell, releases] = await Promise.all([
    readNetworkShell(data),
    nullIfTransient(() => data.getNetworkReleases()),
  ]);
  return (
    <NetworkTabPage shell={shell} tab="software">
      {({ summary }) => <SoftwarePage summary={summary} releases={releases} />}
    </NetworkTabPage>
  );
}
