import type { Metadata } from "next";
import { TermsPage } from "@/features/legal/TermsPage";

export const metadata: Metadata = {
  title: "Terms of use",
  description:
    "What ./shieldedscan is, the limits of its data, how the free public API may be used, and the liability position. It is not a wallet and never asks for a key.",
};

export default function Page() {
  return <TermsPage />;
}
