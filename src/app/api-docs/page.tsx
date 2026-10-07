import type { Metadata } from "next";
import { ApiDocsPage } from "@/features/api/ApiDocsPage";

export const metadata: Metadata = { title: "API" };

/**
 * Served at /api-docs rather than /api: the App Router treats app/api/ as the API-routes
 * convention directory, and a page there invites every future reader to assume route
 * handlers live in it. The footer link and all prose still say "API".
 */
export default function Page() {
  return <ApiDocsPage />;
}
