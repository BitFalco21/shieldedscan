import type { Metadata } from "next";
import { PrivacyPage } from "@/features/legal/PrivacyPage";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "No cookies, no analytics, no browser storage and no third-party requests — plus an honest account of what is unavoidably processed to serve a page, and your rights under the GDPR.",
};

export default function Page() {
  return <PrivacyPage />;
}
