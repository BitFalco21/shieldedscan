import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDataSource } from "@/data";
import { BlockDetailPage } from "@/features/blocks/BlockDetailPage";
import { Nu7CountdownPage } from "@/features/blocks/nu7/Nu7CountdownPage";
import { HEARTBEAT_BLOCKS, isNu7CountdownId } from "@/features/blocks/nu7/nu7-countdown";
import { isTestnet } from "@/lib/network";

/*
 * No edge-cache policy covers `/block/:id` (`lib/edge-cache.ts`), and a 404 from the API never
 * enters Next's fetch Data Cache (only a 200 does), so the NU7 countdown below is never served
 * from a stored copy once its block exists.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  if (isNu7CountdownId(id, isTestnet) && !(await getDataSource().getBlock(id))) {
    return { title: "NU7 countdown" };
  }
  return { title: `Block ${id}` };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = getDataSource();
  const block = await data.getBlock(id);
  if (!block) {
    // The activation height is opened before it exists; everything else missing is a 404.
    if (!isNu7CountdownId(id, isTestnet)) notFound();
    // `listBlocks`, coalesced and read from the index: this render is not cached, and
    // `listLatestBlocks` would ask the node for each block.
    const [chain, recent] = await Promise.all([
      data.getChainInfo(),
      data.listBlocks({ limit: HEARTBEAT_BLOCKS }),
    ]);
    return (
      <Nu7CountdownPage
        tipHeight={chain.height}
        tipTimestamp={chain.lastBlockTimestamp}
        recent={recent.items}
      />
    );
  }
  const [txs, chain, oldestHeight] = await Promise.all([
    data.getBlockTransactions(block),
    data.getChainInfo(),
    data.getOldestHeight(),
  ]);
  return (
    <BlockDetailPage block={block} txs={txs} tipHeight={chain.height} oldestHeight={oldestHeight} />
  );
}
