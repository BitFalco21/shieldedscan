import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDataSource } from "@/data";
import { CrossChainDetailPage } from "@/features/crosschain/CrossChainDetailPage";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return { title: `Transfer ${id}` };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = getDataSource();
  const transfer = await data.getCrossChainTransfer(id);
  if (!transfer) notFound();
  const zcashTxHref =
    transfer.zcashTxid !== null && (await data.getTransaction(transfer.zcashTxid))
      ? `/tx/${transfer.zcashTxid}`
      : null;
  return <CrossChainDetailPage transfer={transfer} zcashTxHref={zcashTxHref} />;
}
