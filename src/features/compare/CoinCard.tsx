import type { ReactNode } from "react";
import type { MarketAsset } from "@/domain";
import { ChainLogo } from "@/components/ChainLogo";
import { formatCount, formatUsdCompact, formatUsdExact } from "@/lib/format";

export interface CoinCardProps {
  asset: MarketAsset;
  /**
   * Which side of the formula this is. `fixed` is Zcash — the page prices ZEC and nothing
   * else — and `choose` is the asset the reader picks. Drawn as a corner label and a border
   * weight, so the two cards read as the same object with a different job rather than as two
   * unrelated panels.
   */
  role: "fixed" | "choose";
  /** The control (or the note standing in for one) at the foot of the card. */
  children?: ReactNode;
}

/**
 * One side of the comparison, as a card: the mark at 96px, the name, the ticker and rank,
 * then the three figures the formula uses.
 *
 * Each asset is its own card, coin A left and coin B right, with the two market caps a reader
 * would divide facing each other as the bold row, so a screenshot keeps what produced the figure.
 *
 * `title` on the market cap carries the exact figure — `e2e/compare.spec.ts` reads it back
 * and recomputes the multiple from the two cards, which is the page's central honesty check.
 */
export function CoinCard({ asset, role, children }: CoinCardProps) {
  return (
    <div
      className={`panel relative flex flex-col items-center px-5 pt-7 pb-5 text-center ${
        role === "choose" ? "border-edge-strong" : ""
      }`}
      data-coin-role={role}
    >
      <span className="microlabel absolute top-3 left-3.5 text-ink-faint">
        {role === "fixed" ? "coin A · fixed" : "coin B · choose"}
      </span>
      <div className="mt-2">
        <ChainLogo chain={asset.symbol} fallbackChain={asset.id} size="xl" />
      </div>
      <div
        className={`mt-4 text-[26px] leading-tight font-bold tracking-tight ${
          role === "fixed" ? "text-green" : "text-ink-bright"
        }`}
      >
        {asset.name}
      </div>
      <div className="mt-1 text-[13px] tracking-[0.12em] text-ink-dim">
        {asset.rank === null ? asset.symbol : `${asset.symbol} · #${asset.rank}`}
      </div>
      <dl className="mt-4 grid w-full grid-cols-[auto_1fr] gap-x-3.5 gap-y-1.5 text-left text-[13px]">
        <dt className="text-ink-faint">price</dt>
        <dd className="text-right font-mono text-ink tabular-nums">
          {formatUsdExact(asset.priceUsd)}
        </dd>
        <dt className="text-ink-faint">market cap</dt>
        <dd
          className="text-right font-mono font-medium text-ink-bright tabular-nums"
          title={formatUsdExact(asset.marketCapUsd)}
        >
          {formatUsdCompact(asset.marketCapUsd)}
        </dd>
        <dt className="text-ink-faint">circulating</dt>
        <dd className="text-right font-mono text-ink tabular-nums">
          {formatCount(Math.round(asset.circulatingSupply))}{" "}
          <span className="text-ink-faint">{asset.symbol}</span>
        </dd>
      </dl>
      {children ? <div className="mt-4 w-full">{children}</div> : null}
    </div>
  );
}
