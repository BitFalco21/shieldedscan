import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DataUnavailable } from "@/components/DataUnavailable";
import { getPrerenderedDataSource } from "@/data";
import { UpgradePage } from "@/features/network/upgrade/UpgradePage";
import { isTestnet } from "@/lib/network";
import { readNetworkShell } from "../shell-data";
import { NetworkTabPage } from "../NetworkTabPage";
import { nullIfTransient } from "@/lib/transient-upstream";
import { networkShareMetadata } from "@/features/network/net-share";

/** Prerendered with a short revalidate; see the map route for the reasoning. */
export const revalidate = 60;

export const metadata: Metadata = {
  title: "NU7 readiness",
  description:
    "How many of the Zcash network's answering nodes run a release that can activate NU7 on mainnet, which protocol versions they declare, and which have fallen behind the tip, day by day.",
  ...networkShareMetadata("NU7 readiness"),
};

export default async function Page() {
  if (isTestnet) notFound();
  const data = getPrerenderedDataSource();
  const [shell, releases] = await Promise.all([
    readNetworkShell(data),
    nullIfTransient(() => data.getNetworkReleases()),
  ]);
  return (
    <NetworkTabPage shell={shell} tab="upgrade">
      {() =>
        releases === null ? (
          <DataUnavailable what="The release record" refreshesWithin="a minute" />
        ) : (
          <UpgradePage releases={releases} />
        )
      }
    </NetworkTabPage>
  );
}
