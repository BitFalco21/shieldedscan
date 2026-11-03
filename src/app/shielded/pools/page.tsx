import type { Metadata } from "next";
import { getCachedDataSource } from "@/data";
import { ShieldedPage } from "@/features/shielded/ShieldedPage";
import { nullIfTransient } from "@/lib/transient-upstream";

/**
 * Rendered on request, never at build, so a deploy cannot depend on the API; the edge cache
 * (`lib/edge-cache.ts`) shares one render among readers. Warmed every two minutes; pool balances
 * move per block and the panel prints the height it was read at.
 */
export const dynamic = "force-dynamic";

/**
 * Served at `/shielded?view=shielded`: the proxy rewrites that URL here, so the view keeps its
 * own CDN entry while `/shielded` stays the all-pools view.
 */
export const metadata: Metadata = {
  title: "Shielded Pools",
  description: "Ironwood, Orchard, Sapling and Sprout pool balances and total shielded supply.",
  alternates: { canonical: "/shielded?view=shielded" },
};

/**
 * The supply series comes from an expensive rollup aggregation. Here it feeds only the chart
 * (the pool balances, the shielded total and the supply table all come from the node), so a
 * slow rollup degrades one panel instead of the page, and never the deploy.
 *
 * `null`, not `[]`: an empty series would draw a chart asserting no shielded value has
 * ever existed. A skew error still propagates, so the build tripwire is intact.
 */
export default async function Page() {
  const data = getCachedDataSource();
  // One round trip. The series and the Ironwood panel degrade on their own through
  // `nullIfTransient`: the pool cards come from the node and are unaffected, and for Ironwood
  // `null` is also the legitimate value before activation, so both paths land on the same
  // behaviour.
  const [chain, pools, supply, series, ironwood] = await Promise.all([
    data.getChainInfo(),
    data.getPools(),
    data.getSupplyBreakdown(),
    nullIfTransient(() => data.getSupplySeries()),
    nullIfTransient(() => data.getIronwoodInflow()),
  ]);
  return (
    <ShieldedPage chain={chain} pools={pools} series={series} supply={supply} ironwood={ironwood} />
  );
}
