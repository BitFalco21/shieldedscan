import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  MINERS_DEFAULT_WINDOW,
  MINING_POOLS,
  parseMinersWindow,
  type MinersWindowKey,
  type MiningPoolId,
} from "@/domain";
import { getDataSource } from "@/data";
import { DataUnavailable } from "@/components/DataUnavailable";
import { MiningPoolPage } from "@/features/miners/MiningPoolPage";
import { nowSeconds } from "@/lib/clock";
import { isTestnet } from "@/lib/network";
import { isTransientUpstream, nullIfTransient } from "@/lib/transient-upstream";

/** Windows end today, at the tip: never serve a stale Data Cache entry. */
export const fetchCache = "force-no-store";

type Params = Promise<{ pool: string }>;

const poolOf = (id: string) =>
  Object.hasOwn(MINING_POOLS, id) ? MINING_POOLS[id as MiningPoolId] : null;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const pool = poolOf((await params).pool);
  return pool === null
    ? { title: "Mining pool not found" }
    : {
        title: `${pool.name} · Miners`,
        description: `${pool.name}'s Zcash blocks and what they paid, from its reviewed payout addresses.`,
      };
}

/** A reviewed pool's page. An id the registry does not have answers 404, never an empty page. */
export default async function Page({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Promise<{ window?: string }>;
}) {
  if (isTestnet) notFound();
  const pool = poolOf((await params).pool);
  if (pool === null) notFound();
  const window = parseMinersWindow((await searchParams).window);
  const base = `/miners/${pool.id}`;
  const windowHref = (key: MinersWindowKey) =>
    key === MINERS_DEFAULT_WINDOW ? base : `${base}?window=${key}`;

  const data = getDataSource();
  let overview;
  try {
    overview = await data.getMinersOverview(window);
  } catch (error) {
    if (!isTransientUpstream(error)) throw error;
    return <DataUnavailable what={`${pool.name}'s figures`} />;
  }
  const [terms, months, blocks] = await Promise.all([
    nullIfTransient(() => data.getMiningTerms()),
    nullIfTransient(() => data.getMinerSeries("month")),
    nullIfTransient(() => data.getMiningPoolBlocks(pool.id)),
  ]);
  return (
    <MiningPoolPage
      pool={pool}
      overview={overview}
      livePriceUsd={terms?.priceUsd ?? null}
      months={months}
      blocks={blocks}
      nowSec={nowSeconds()}
      windowHref={windowHref}
    />
  );
}
