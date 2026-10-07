import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPrerenderedDataSource } from "@/data";
import { SoftwarePage } from "@/features/network/software/SoftwarePage";
import { isTestnet } from "@/lib/network";
import { readNetworkShell } from "../shell-data";
import { NetworkTabPage } from "../NetworkTabPage";
import { networkShareMetadata } from "@/features/network/net-share";

/** Prerendered with a short revalidate; see the map route for the reasoning. */
export const revalidate = 60;

export const metadata: Metadata = {
  title: "Node software",
  description:
    "Which implementations the Zcash network's answering nodes run, how each answers a crawl, and which releases and protocol versions they declare.",
  ...networkShareMetadata("software"),
};

export default async function Page() {
  if (isTestnet) notFound();
  const shell = await readNetworkShell(getPrerenderedDataSource());
  return (
    <NetworkTabPage shell={shell} tab="software">
      {({ summary }) => <SoftwarePage summary={summary} />}
    </NetworkTabPage>
  );
}
