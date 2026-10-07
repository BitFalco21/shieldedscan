import type { Metadata } from "next";
import { EcosystemPage } from "@/features/ecosystem/EcosystemPage";
import { pageShareMetadata } from "@/lib/share-card";

const TITLE = "The Zcash ecosystem";
const DESCRIPTION =
  "Wallets, exchanges, payments, mining pools, nodes, developer tools and the teams building Zcash, on one map.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  ...pageShareMetadata(TITLE, DESCRIPTION),
};

/**
 * `/ecosystem`. Fully static — committed editorial data, no fetch — so there is no revalidate
 * window to declare and no `loading.tsx` concern. Served on both networks: it lists projects,
 * not chain figures, so nothing on it is a mainnet number under testnet chrome.
 */
export default function Page() {
  return <EcosystemPage />;
}
