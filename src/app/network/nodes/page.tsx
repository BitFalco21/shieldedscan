import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DataUnavailable } from "@/components/DataUnavailable";
import { getDataSource } from "@/data";
import { cursorNavHrefs } from "@/app/_shared/cursor-nav";
import { parseAsnFilter, parseNetClientFilter } from "@/domain";
import { networkNodesHref } from "@/features/network/nodes/networkNodesHref";
import { NodesListPage } from "@/features/network/nodes/NodesListPage";
import { isTestnet } from "@/lib/network";
import { readNetworkShell } from "../shell-data";
import { NetworkTabPage } from "../NetworkTabPage";
import { nullIfTransient } from "@/lib/transient-upstream";
import { networkShareMetadata } from "@/features/network/net-share";

/**
 * The one dynamic tab: it reads its filter and its cursor from the URL, so it is never served
 * from Next's fetch Data Cache, where a stale entry is returned and refreshed behind the
 * response.
 */
export const fetchCache = "force-no-store";

export const metadata: Metadata = {
  title: "Answering nodes",
  description:
    "Every Zcash node that answered this explorer's crawler recently, one row each — software, location, hosting network, latency and how often it answers our crawler. No addresses.",
  ...networkShareMetadata("answering nodes"),
};

const PAGE_SIZE = 25;

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ before?: string; after?: string; client?: string; asn?: string }>;
}) {
  if (isTestnet) notFound();
  const { before, after, client: rawClient, asn: rawAsn } = await searchParams;
  // Parsed in the domain: a malformed value means all, a well-formed unknown client is kept
  // and yields an honest empty page rather than showing the rows a reader excluded.
  const filters = { client: parseNetClientFilter(rawClient), asn: parseAsnFilter(rawAsn) };
  const data = getDataSource();
  const [shell, page, health] = await Promise.all([
    readNetworkShell(data),
    nullIfTransient(() => data.listNetworkNodes({ before, after, limit: PAGE_SIZE }, filters)),
    nullIfTransient(() => data.getNetworkHealth()),
  ]);
  return (
    <NetworkTabPage shell={shell} tab="nodes">
      {({ summary }) =>
        page === null ? (
          <DataUnavailable what="The list of answering nodes" refreshesWithin="a minute" />
        ) : (
          <NodesListPage
            page={page}
            clients={summary.clients}
            hostingNetworks={(health?.concentration.topAsns ?? []).map((a) => ({
              asn: a.asn,
              org: a.org,
              count: a.numerator,
            }))}
            now={summary.asOf}
            windowSeconds={summary.windowSeconds}
            // Every control carries the echoed filter, so paging can never widen the list.
            {...cursorNavHrefs(page, (step) => networkNodesHref(page.applied, step))}
          />
        )
      }
    </NetworkTabPage>
  );
}
