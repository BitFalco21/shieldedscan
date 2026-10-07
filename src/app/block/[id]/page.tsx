import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDataSource } from "@/data";
import { BlockDetailPage } from "@/features/blocks/BlockDetailPage";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return { title: `Block ${id}` };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = getDataSource();
  const block = await data.getBlock(id);
  if (!block) notFound();
  const [txs, chain, oldestHeight] = await Promise.all([
    data.getBlockTransactions(block),
    data.getChainInfo(),
    data.getOldestHeight(),
  ]);
  return (
    <BlockDetailPage block={block} txs={txs} tipHeight={chain.height} oldestHeight={oldestHeight} />
  );
}
