import type { Metadata } from "next";
import { getPrerenderedDataSource } from "@/data";
import { ShieldedPage } from "@/features/shielded/ShieldedPage";
import { nullIfTransient } from "@/lib/transient-upstream";

/**
 * Prerendered at 60 s and warmed every two minutes; pool balances move per block and the panel
 * prints the height it was read at. Declared explicitly because the build legend shows nothing
 * for a window inferred from fetches, and Next takes the minimum window across the route: the
 * page reads through `getPrerenderedDataSource`, whose tip window matches this.
 */
export const revalidate = 60;

export const metadata: Metadata = {
  title: "Shielded Pools",
  description: "Ironwood, Orchard, Sapling and Sprout pool balances and total shielded supply.",
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
  const data = getPrerenderedDataSource();
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
