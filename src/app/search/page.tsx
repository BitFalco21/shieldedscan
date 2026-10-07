import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { classifySearchQuery } from "@/domain";
import { getDataSource } from "@/data";
import { isTestnet } from "@/lib/network";
import { nullIfTransient } from "@/lib/transient-upstream";
import { SearchResultsPage, type SearchState } from "@/features/search/SearchResultsPage";

// Tip-sensitive: skip Next's fetch Data Cache (ARCHITECTURE.md, "Caching and freshness").
export const fetchCache = "force-no-store";

export const metadata: Metadata = {
  title: "Search",
  description:
    "Search the Zcash chain by block height, hash, transaction id, address, or Zcash name.",
};

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const parsed = classifySearchQuery(q);
  const data = getDataSource();

  let state: SearchState;
  switch (parsed.type) {
    case "empty":
      state = { kind: "prompt" };
      break;
    case "invalid":
      state = { kind: "invalid" };
      break;
    case "height": {
      if (await data.getBlock(String(parsed.height))) redirect(`/block/${parsed.height}`);
      const tip = (await data.getChainInfo()).height;
      state =
        parsed.height > tip
          ? { kind: "beyond-tip", height: parsed.height, tip }
          : { kind: "not-found" };
      break;
    }
    case "hash64": {
      const [block, tx] = await Promise.all([
        data.getBlock(parsed.hash),
        data.getTransaction(parsed.hash),
      ]);
      if (block && tx) {
        state = {
          kind: "ambiguous",
          hash: parsed.hash,
          blockHref: `/block/${block.hash}`,
          txHref: `/tx/${tx.txid}`,
        };
      } else if (block) {
        redirect(`/block/${block.hash}`);
      } else if (tx) {
        redirect(`/tx/${tx.txid}`);
      } else {
        state = { kind: "not-found" };
      }
      break;
    }
    case "transparent-address": {
      if (await data.getAddress(parsed.address)) redirect(`/address/${parsed.address}`);
      state = { kind: "not-found" };
      break;
    }
    case "shielded-address":
      redirect(`/address/${parsed.address}`);
    case "name": {
      // The registry is mainnet's; the testnet API mounts no ZNS route, so there a name is
      // simply not something this deployment searches.
      if (isTestnet) {
        state = { kind: "invalid" };
        break;
      }
      // A registry outage reaches the reader as "unavailable", never as a miss, and never as
      // the error boundary, since the search page itself is fine.
      const lookup = await nullIfTransient(() => data.getZnsName(parsed.name));
      const hit = lookup?.registrations[0];
      // A name with a page (registered, or released with a history) goes to it; the page links
      // on to the address.
      if (hit || (lookup && !lookup.withheld && lookup.history.length > 0)) {
        redirect(`/name/${parsed.name}`);
      }
      state =
        lookup === null || lookup.withheld
          ? { kind: "name-unavailable", name: parsed.name }
          : { kind: "name-not-found", name: parsed.name };
      break;
    }
  }

  return <SearchResultsPage state={state} query={q} />;
}
