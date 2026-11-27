import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  exchangeFlowWindowDays,
  exchangeReserveSummary,
  parseExchangeFlowWindow,
  parseExchangeParam,
  type ExchangeFlowWindowId,
  type ExchangeId,
} from "@/domain";
import { getDataSource } from "@/data";
import { DataUnavailable } from "@/components/DataUnavailable";
import { ExchangeFlowsPage } from "@/features/exchanges/ExchangeFlowsPage";
import { isTestnet } from "@/lib/network";
import { isTransientUpstream, nullIfTransient } from "@/lib/transient-upstream";

// Never served from Next's fetch Data Cache: on a dynamic render a stale entry is returned and
// refreshed behind the response. The adapter holds its own one-minute memo instead.
export const fetchCache = "force-no-store";

export const metadata: Metadata = {
  title: "Exchange Flows",
  description:
    "ZEC moving into and out of the exchange addresses ShieldedScan labels — Binance, Coinbase, Gemini, Kraken, OKX, KuCoin, Bitget and Gate — and where it came from or went.",
};

/**
 * No `loading.tsx` above this route (rule 15). The labels and the flows are mainnet's, so the
 * page is absent on testnet.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ window?: string; exchange?: string }>;
}) {
  if (isTestnet) notFound();
  const q = await searchParams;
  const range = parseExchangeFlowWindow(q.window);
  const exchange = parseExchangeParam(q.exchange);
  // Defaults are left out of the URL, so the plain page shares one address.
  const href = (next: { window?: ExchangeFlowWindowId; exchange?: ExchangeId | null }) => {
    const w = next.window ?? range;
    const e = next.exchange === undefined ? exchange : next.exchange;
    const params = new URLSearchParams();
    if (w !== "30d") params.set("window", w);
    if (e !== null) params.set("exchange", e);
    const s = params.toString();
    return s === "" ? "/exchanges" : `/exchanges?${s}`;
  };

  const data = getDataSource();
  const days = exchangeFlowWindowDays(range);
  // The page's subject: an outage is named, any other failure throws (a wrong shape is loud).
  let flows;
  try {
    flows = await data.getExchangeFlows(days);
  } catch (error) {
    if (!isTransientUpstream(error)) throw error;
    return <DataUnavailable what="The exchange flows" />;
  }
  const [movements, reserveDays] = await Promise.all([
    nullIfTransient(() => data.getExchangeMovements(days, exchange)),
    nullIfTransient(() => data.getExchangeReserves()),
  ]);
  return (
    <ExchangeFlowsPage
      flows={flows}
      movements={movements}
      reserves={reserveDays === null ? null : exchangeReserveSummary(reserveDays)}
      range={range}
      exchange={exchange}
      href={href}
    />
  );
}
