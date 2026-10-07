import type { Metadata } from "next";
import { AboutPage } from "@/features/about/AboutPage";

export const metadata: Metadata = {
  title: "About",
  description:
    "A privacy-first Zcash block explorer, run by one person from a full archive node. What it does differently, where its numbers come from, and what it will never do.",
};

// Static prose page with no data port: nothing here can call notFound(), and there is no
// loading.tsx above it (a Suspense boundary would commit HTTP 200 before notFound() runs).
export default function Page() {
  return <AboutPage />;
}
