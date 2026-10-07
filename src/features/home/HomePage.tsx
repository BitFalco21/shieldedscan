import type {
  BlockSummary,
  ChainInfo,
  CrossChainTransfer,
  ShieldedPool,
  Transaction,
} from "@/domain";
import { marketCapUsd, totalShieldedZat } from "@/domain";
import { StatCard } from "@/components/StatCard";
import { StatGrid } from "@/components/StatGrid";
import { Unmeasured } from "@/components/Unmeasured";
import {
  formatCount,
  formatUsd,
  formatUsdCompact,
  formatUsdExact,
  formatZecCompact,
} from "@/lib/format";
import { isTestnet, network } from "@/lib/network";
import { HeroCityBackdrop } from "./HeroCityBackdrop";
import { HeroSearch } from "./HeroSearch";
import { HomeLivePanels } from "./HomeLivePanels";

export interface HomePageProps {
  chain: ChainInfo;
  /** Only for the shielded-supply stat card; the pool chart lives on /shielded. */
  pools: ShieldedPool[];
  latestBlocks: BlockSummary[];
  latestTxs: Transaction[];
  latestTransfers: CrossChainTransfer[];
}

export function HomePage({
  chain,
  pools,
  latestBlocks,
  latestTxs,
  latestTransfers,
}: HomePageProps) {
  const shieldedTotal = totalShieldedZat(pools);
  // Read into locals so the null checks narrow for TypeScript and each card reads once.
  const { txCount24h, fullyShieldedPct24h, priceUsd, priceChange24hPct } = chain;
  const marketCap = marketCapUsd(chain);
  const priceUp = priceChange24hPct !== null && priceChange24hPct >= 0;
  return (
    <>
      {/* The photograph behind the page. Homepage only: atmosphere behind data tables is
          texture over numbers. See HeroCityBackdrop for what keeps the text readable. */}
      <HeroCityBackdrop />

      {/* The space below the prompt fits the search dropdown's usual single row; taller
          results overlay the content below. */}
      <header className="hero-wash pt-8 pb-18 text-center">
        <p className="text-xs tracking-[0.12em] text-green-dim">
          zcash {network} · block {formatCount(chain.height)}
        </p>
        <h1 className="crt-title mt-3 text-[clamp(34px,6vw,64px)] leading-none font-extrabold tracking-[0.07em]">
          PRIVACY IS NORMAL
        </h1>
        <HeroSearch />
      </header>

      {/* Two cards on testnet (the USD pair is absent there, see below), so the grid takes the
          count it actually has rather than leaving two empty columns at `lg`. */}
      <StatGrid columns={isTestnet ? 2 : 4}>
        {/* Market cap is derived (circulating supply × price), so it inherits the price's
            nullability: no price means an unknown market cap, never a stale one.

            Both USD cards are absent on testnet rather than "unavailable": TAZ has no price,
            and a USD figure beside a testnet amount would price something worthless. */}
        {!isTestnet && (
          <StatCard
            label="ZEC MARKET CAP"
            value={
              marketCap === null ? (
                <Unmeasured />
              ) : (
                <span title={formatUsd(marketCap)}>{formatUsdCompact(marketCap)}</span>
              )
            }
            sub={
              marketCap === null
                ? "needs a price to compute"
                : `${formatZecCompact(chain.circulatingSupplyZat)} circulating`
            }
          />
        )}
        <StatCard
          label="SHIELDED SUPPLY"
          value={formatZecCompact(shieldedTotal)}
          sub="across Ironwood · Orchard · Sapling · Sprout"
        />
        {/* The 24h window comes from a poller that is cold just after an API restart, and the
            price from an external feed that can fail. Both render "unavailable" rather than a
            plausible number (see `Unmeasured` and `ChainInfo`). */}
        <StatCard
          label="TRANSACTIONS 24H"
          value={txCount24h === null ? <Unmeasured /> : formatCount(txCount24h)}
          sub={
            fullyShieldedPct24h === null ? (
              "24h window not yet measured"
            ) : (
              <>
                <span className="text-green">{fullyShieldedPct24h}%</span> fully shielded
              </>
            )
          }
        />
        {!isTestnet && (
          <StatCard
            label="ZEC PRICE"
            value={priceUsd === null ? <Unmeasured /> : formatUsdExact(priceUsd)}
            sub={
              priceChange24hPct === null ? (
                "price feed unavailable"
              ) : (
                <>
                  <span className={priceUp ? "text-green" : "text-red"}>
                    {priceUp ? "▲" : "▼"} {Math.abs(priceChange24hPct).toFixed(1)}%
                  </span>{" "}
                  24h
                </>
              )
            }
          />
        )}
      </StatGrid>

      {/* Cross-chain carries the most per row (route, amount, protocol, status), so it gets
          the widest column. On testnet the panel is absent, matching its 404'd routes: no
          venue bridges testnet ZEC, and an empty panel would claim nothing crossed. */}
      <HomeLivePanels
        latestBlocks={latestBlocks}
        latestTxs={latestTxs}
        latestTransfers={latestTransfers}
        now={chain.lastBlockTimestamp}
      />
    </>
  );
}
