import { notFound } from "next/navigation";
import { isTestnet } from "@/lib/network";

/**
 * The whole cross-chain subtree is absent on testnet: no venue bridges testnet ZEC, and an
 * empty page would be a claim that nothing crossed rather than that nothing is measured.
 *
 * A page Next may prerender at build time carries its own guard as well: a prerender runs the
 * page body even when this layout throws (see `flows/page.tsx`).
 *
 * A layout, not a loading.tsx: a loading.tsx's Suspense boundary commits a 200 status before
 * notFound() runs, whereas a layout introduces no boundary.
 */
export default function CrossChainLayout({ children }: { children: React.ReactNode }) {
  if (isTestnet) notFound();
  return children;
}
