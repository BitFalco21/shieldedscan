import type { Metadata } from "next";
import { getDataSource } from "@/data";
import { cursorNavHrefs } from "@/app/_shared/cursor-nav";
import {
  parseChainFilter,
  parseDirectionFilter,
  parseMinUsdFilter,
  parseProtocolFilter,
} from "@/domain";
import { nowSeconds } from "@/lib/clock";
import { CrossChainListPage } from "@/features/crosschain/CrossChainListPage";
import {
  type CrossChainFilterState,
  crossChainHref,
  toCrossChainNarrowing,
} from "@/features/crosschain/crossChainHref";

// Tip-sensitive: skip Next's fetch Data Cache (ARCHITECTURE.md, "Caching and freshness").
export const fetchCache = "force-no-store";

export const metadata: Metadata = {
  title: "Cross-Chain",
  description: "ZEC entering and leaving Zcash via swap protocols.",
};

const PAGE_SIZE = 25;

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{
    before?: string;
    after?: string;
    protocol?: string;
    direction?: string;
    source?: string;
    destination?: string;
    min?: string;
  }>;
}) {
  const params = await searchParams;
  const { before, after } = params;
  // Parsed, not trusted: an unrecognised venue or direction means "all", and a chain list
  // keeps only well-shaped tickers, so a hand-edited URL cannot reach the store as anything
  // else. A well-formed chain we hold no rows for is kept deliberately — it produces an
  // honest empty page rather than silently widening the list back to everything.
  const filters: CrossChainFilterState = {
    protocol: parseProtocolFilter(params.protocol),
    direction: parseDirectionFilter(params.direction),
    sourceChains: parseChainFilter(params.source),
    destinationChains: parseChainFilter(params.destination),
    minUsd: parseMinUsdFilter(params.min),
  };
  // One mapping, shared with the live feed — see `toCrossChainNarrowing`.
  const query = toCrossChainNarrowing(filters);
  const data = getDataSource();
  const totalPromise = data.countCrossChainTransfers(query).catch(() => null);
  const volumePromise = data.getCrossChainVolume().catch(() => null);
  // Only the chain NAMES, for the two menus. An unreadable list costs the menus and nothing
  // else: `[]` renders no chain filters rather than an empty one, and the page still lists
  // transfers. Memoised in the adapter, so this is not a per-view round trip.
  const chainsPromise = data.getCrossChainChains().catch(() => []);
  const {
    items: transfers,
    nextCursor,
    prevCursor,
  } = await data.listCrossChainTransfers(
    {
      before,
      after,
      limit: PAGE_SIZE,
    },
    query,
  );
  // Wall clock, not the Zcash chain tip: a swap on another venue is an external event whose
  // age has nothing to do with Zcash block times.
  const now = nowSeconds();

  // Every pagination link carries every filter, from the same builder the controls use.
  // Dropping one would silently widen the list on the next page.
  return (
    <CrossChainListPage
      transfers={transfers}
      total={await totalPromise}
      volume={await volumePromise}
      chains={await chainsPromise}
      now={now}
      filters={filters}
      {...cursorNavHrefs({ nextCursor, prevCursor }, (step) =>
        crossChainHref(filters, step && { [step.name]: step.value }),
      )}
    />
  );
}
