import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  MINERS_DEFAULT_WINDOW,
  parseMinersWindow,
  type MinerSeries,
  type MinersWindowKey,
} from "@/domain";
import { getDataSource } from "@/data";
import { DataUnavailable } from "@/components/DataUnavailable";
import { MinersPage } from "@/features/miners/MinersPage";
import { isTestnet } from "@/lib/network";
import { isTransientUpstream, nullIfTransient } from "@/lib/transient-upstream";

/** Windows end today, at the tip: never serve a stale Data Cache entry. */
export const fetchCache = "force-no-store";

export const metadata: Metadata = {
  title: "Miners",
  description:
    "Who mined Zcash and what their blocks paid them, by mining pool, over the last 7, 30 or 90 days.",
};

/** The days the daily charts draw: the series covers a year, the page shows a quarter. */
const DAYS_DRAWN = 90;

function lastDays(series: MinerSeries): MinerSeries {
  const periods = series.periods.slice(-DAYS_DRAWN);
  const from = periods[0]?.period ?? series.fromDay;
  return {
    ...series,
    fromDay: from,
    periods,
    points: series.points.filter((p) => p.period >= from),
  };
}

/**
 * No `loading.tsx` above this route (see `/mining`'s note): it never 404s on mainnet, but the
 * rule holds for the directory. The mining rollup and the price are mainnet-only, so the page is
 * absent on testnet.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>;
}) {
  if (isTestnet) notFound();
  const window = parseMinersWindow((await searchParams).window);
  // The default is omitted from the URL, so an unfiltered request shares one cache key.
  const windowHref = (key: MinersWindowKey) =>
    key === MINERS_DEFAULT_WINDOW ? "/miners" : `/miners?window=${key}`;

  const data = getDataSource();
  // The page's subject: an outage is named, any other failure throws (a wrong shape is loud).
  let overview;
  try {
    overview = await data.getMinersOverview(window);
  } catch (error) {
    if (!isTransientUpstream(error)) throw error;
    return <DataUnavailable what="The miners overview" />;
  }
  const [terms, months, days, nsm] = await Promise.all([
    nullIfTransient(() => data.getMiningTerms()),
    nullIfTransient(() => data.getMinerSeries("month")),
    nullIfTransient(() => data.getMinerSeries("day")),
    nullIfTransient(() => data.getNsmOverview()),
  ]);
  return (
    <MinersPage
      overview={overview}
      terms={terms}
      months={months}
      days={days === null ? null : lastDays(days)}
      nsm={nsm}
      windowHref={windowHref}
    />
  );
}
