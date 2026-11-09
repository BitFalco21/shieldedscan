import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DataUnavailable } from "@/components/DataUnavailable";
import { getCachedDataSource } from "@/data";
import { HealthPage } from "@/features/network/health/HealthPage";
import { isTestnet } from "@/lib/network";
import { readNetworkShell } from "../shell-data";
import { NetworkTabPage } from "../NetworkTabPage";
import { nullIfTransient } from "@/lib/transient-upstream";
import { networkShareMetadata } from "@/features/network/net-share";

/**
 * Rendered on request, never at build, so a deploy cannot depend on the API; the edge cache
 * (`lib/edge-cache.ts`) shares one render among readers. See the map route for why a cached copy is
 * safe.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Network health",
  description:
    "How concentrated the Zcash network's hosting is, how often its nodes answer our crawler, and what a crawler cannot see. No health score.",
  ...networkShareMetadata("health"),
};

export default async function Page() {
  if (isTestnet) notFound();
  const data = getCachedDataSource();
  const [shell, health, hosting] = await Promise.all([
    readNetworkShell(data),
    nullIfTransient(() => data.getNetworkHealth()),
    nullIfTransient(() => data.getNodeHosting()),
  ]);
  return (
    <NetworkTabPage shell={shell} tab="health">
      {({ peers }) =>
        health === null ? (
          <DataUnavailable what="The network's health figures" />
        ) : (
          <HealthPage health={health} peers={peers} hosting={hosting} />
        )
      }
    </NetworkTabPage>
  );
}
