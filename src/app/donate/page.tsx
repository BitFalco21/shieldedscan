import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DonatePage } from "@/features/donate/DonatePage";
import { isTestnet } from "@/lib/network";

export const metadata: Metadata = { title: "Donate" };

// Static page, no data port. The testnet notFound() below means this route can 404, so no
// loading.tsx may sit above it (a Suspense boundary would commit HTTP 200 first).
export default function Page() {
  // TAZ is worthless and the donation address is a mainnet unified address: a donate page
  // on testnet solicits either nothing or a mistake.
  if (isTestnet) notFound();
  return <DonatePage />;
}
