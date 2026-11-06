import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDataSource } from "@/data";
import { SubjectUnavailable } from "@/components/SubjectUnavailable";
import { BlockDetailPage } from "@/features/blocks/BlockDetailPage";
import { Nu7CountdownPage } from "@/features/blocks/nu7/Nu7CountdownPage";
import {
  FIRST_NU7_BLOCKS,
  HEARTBEAT_BLOCKS,
  isNu7CountdownId,
} from "@/features/blocks/nu7/nu7-countdown";
import { NU7_HEIGHT } from "@/domain";
import { encodeCursor } from "@/data/cursor";
import { isTestnet } from "@/lib/network";
import { nullIfTransient } from "@/lib/transient-upstream";

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
  // Only a definite absence is the countdown: a read that failed keeps the plain title.
  if (
    isNu7CountdownId(id, isTestnet) &&
    (await nullIfTransient(() => getDataSource().getBlock(id))) === undefined
  ) {
    return { title: "NU7 countdown" };
  }
  return { title: `Block ${id}` };
}

/**
 * The block is the page's subject: if it cannot be read, the page says so under the id rather
 * than claiming it does not exist. Its transactions, the tip (confirmations, "next") and the
 * oldest height ("previous") each degrade on their own.
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = getDataSource();
  const block = await nullIfTransient(() => data.getBlock(id));
  if (block === null) {
    return (
      <SubjectUnavailable
        breadcrumb={[
          { label: "HOME", href: "/" },
          { label: "BLOCKS", href: "/blocks" },
          { label: "BLOCK" },
        ]}
        subject={id}
        what="This block"
      />
    );
  }
  if (block === undefined) {
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
  const isNu7 = block.height === NU7_HEIGHT && !isTestnet;
  const [txs, chain, oldestHeight, nu7Blocks] = await Promise.all([
    nullIfTransient(() => data.getBlockTransactions(block)),
    nullIfTransient(() => data.getChainInfo()),
    nullIfTransient(() => data.getOldestHeight()),
    // The activation block's page charts the first blocks after it: one keyset page ending at
    // the last of them, read from the index like any list. Optional: an outage drops the panel,
    // never the block.
    isNu7
      ? nullIfTransient(async () => {
          const page = await data.listBlocks({
            before: encodeCursor(NU7_HEIGHT + FIRST_NU7_BLOCKS + 1, "0"),
            limit: FIRST_NU7_BLOCKS + 1,
          });
          return page.items;
        })
      : null,
  ]);
  return (
    <BlockDetailPage
      block={block}
      txs={txs}
      tipHeight={chain?.height ?? null}
      oldestHeight={oldestHeight}
      nu7Blocks={nu7Blocks}
    />
  );
}
