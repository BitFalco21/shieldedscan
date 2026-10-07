import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SatoshiPage } from "@/features/satoshi/SatoshiPage";
import { isTestnet } from "@/lib/network";

export const metadata: Metadata = {
  title: "Satoshi's Lock",
  description:
    "A slot machine where every pull is a real attempt at the Bitcoin genesis key — and why Zcash has no door to point at.",
};

/**
 * Static page, no data port: the key is drawn and derived in the visitor's browser, and the
 * one Bitcoin figure on the page is a dated constant. The testnet `notFound()` means this
 * route can 404, so no `loading.tsx` may sit above it.
 *
 * Mainnet-only: the page's Zcash half contrasts a mainnet shielded
 * pool with a Bitcoin address, and testnet would add nothing but a second copy.
 */
export default function Page() {
  if (isTestnet) notFound();
  return <SatoshiPage />;
}
