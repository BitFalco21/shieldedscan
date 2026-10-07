import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AgentPage } from "@/features/agent/AgentPage";
import { isAgentEnabled } from "@/lib/agent";

export const metadata: Metadata = { title: "Zeno — AI agent" };

/**
 * `/ai-agent`, gated on the deployment's own flag.
 *
 * `notFound()` rather than a "coming soon" page: an unfinished feature reachable by URL is
 * indistinguishable from a finished one. There is deliberately no `loading.tsx` above this
 * route: one creates a Suspense boundary that commits HTTP 200 before this component runs, so
 * a not-found screen would be served with the wrong status.
 */
export default function Page() {
  if (!isAgentEnabled) notFound();
  return <AgentPage />;
}
