import type { Metadata } from "next";
import { McpPage } from "@/features/api/McpPage";

export const metadata: Metadata = {
  title: "MCP server",
  description:
    "Connect an AI assistant to ShieldedScan: every public API endpoint as an MCP tool. Keyless, read-only, nothing stored.",
};

/** Static: the page is derived from the API catalogue at build time and reads no data. */
export default function Page() {
  return <McpPage />;
}
