import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DataUnavailable } from "@/components/DataUnavailable";
import { getPrerenderedDataSource } from "@/data";
import { HealthPage } from "@/features/network/health/HealthPage";
import { isTestnet } from "@/lib/network";
import { readNetworkShell } from "../shell-data";
import { NetworkTabPage } from "../NetworkTabPage";
import { nullIfTransient } from "@/lib/transient-upstream";
import { networkShareMetadata } from "@/features/network/net-share";

/** Prerendered with a short revalidate; see the map route for the reasoning. */
export const revalidate = 60;

export const metadata: Metadata = {
  title: "Network health",
  description:
    "How concentrated the Zcash network's hosting is, how often its nodes answer our crawler, and what a crawler cannot see. No health score.",
  ...networkShareMetadata("health"),
};

export default async function Page() {
  if (isTestnet) notFound();
  const data = getPrerenderedDataSource();
  const [shell, health] = await Promise.all([
    readNetworkShell(data),
    nullIfTransient(() => data.getNetworkHealth()),
  ]);
  return (
    <NetworkTabPage shell={shell} tab="health">
      {({ peers }) =>
        health === null ? (
          <DataUnavailable what="The network's health figures" refreshesWithin="a minute" />
        ) : (
          <HealthPage health={health} peers={peers} />
        )
      }
    </NetworkTabPage>
  );
}
