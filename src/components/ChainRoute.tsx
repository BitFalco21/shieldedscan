import type { CrossChainTransfer } from "@/domain";
import { assetTickerIsKnown } from "@/domain";
import { chainName } from "@/lib/chains";
import { formatAssetAmount, formatZec } from "@/lib/format";
import { ChainLogo } from "@/components/ChainLogo";

export interface ChainRouteProps {
  transfer: CrossChainTransfer;
}

/** One side of the route: mark, then amount-with-unit, or the bare ticker if unknown. */
function Leg({
  ticker,
  amount,
  chain,
  emphasis,
}: {
  ticker: string;
  /** Pre-formatted and already carrying its unit; `null` when the venue published none. */
  amount: string | null;
  /** The chain this asset sits on, for the mark when the asset itself has no brand. */
  chain: string;
  emphasis: "normal" | "strong";
}) {
  const named = assetTickerIsKnown(ticker);
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      {amount === null ? (
        // No fabricated number: an unsettled leg has no amount yet, so the mark and ticker
        // stand alone rather than borrowing a zero.
        <>
          <ChainLogo chain={ticker} fallbackChain={chain} emphasis={emphasis} />
          <span className="text-[11px] text-ink-dim">{named ? ticker : "unidentified token"}</span>
        </>
      ) : (
        // Amount, then mark; the ticker is already inside `amount`. The mark sits with the
        // unit it identifies rather than in front of the quantity, as in `TransferLeg`.
        <>
          <span className="text-[11px] text-ink-bright tabular-nums">{amount}</span>
          <ChainLogo chain={ticker} fallbackChain={chain} emphasis={emphasis} />
        </>
      )}
    </span>
  );
}

/**
 * Source → destination for a cross-chain transfer: which asset moved, how much of it, and on
 * which chain — with Zcash always on the side the direction implies.
 *
 * 400 USDC swapped on Ethereum for ZEC is not a swap of ETH, so the asset is shown, with the
 * chain named underneath only when it differs ("ETH on Ethereum" is noise).
 *
 * Both amounts carry their unit — two bare numbers either side of an arrow invite being read
 * as an exchange rate.
 */
export function ChainRoute({ transfer }: ChainRouteProps) {
  const {
    direction,
    counterpartChain,
    counterpartAsset,
    counterpartAmount,
    counterpartIsSynthetic,
    zecAmountZat,
  } = transfer;

  const zec = { ticker: "ZEC", chain: "ZEC", amount: formatZec(zecAmountZat) };
  const other = {
    ticker: counterpartAsset,
    chain: counterpartChain,
    amount:
      counterpartAmount === null
        ? null
        : // The unit is appended only when it is a real ticker; appending the placeholder
          // would produce "9,211.6 SOL asset".
          assetTickerIsKnown(counterpartAsset)
          ? `${formatAssetAmount(counterpartAmount)} ${counterpartAsset}`
          : formatAssetAmount(counterpartAmount),
  };

  const inbound = direction === "in";
  const source = inbound ? other : zec;
  const destination = inbound ? zec : other;

  // Named only when it adds something: the chain an asset sits on matters for
  // USDC-on-Arbitrum and is redundant for ETH-on-Ethereum.
  const venueChain =
    counterpartAsset.toUpperCase() === counterpartChain.toUpperCase()
      ? null
      : chainName(counterpartChain);

  return (
    <span
      className="inline-flex min-w-0 flex-col gap-0.5"
      aria-label={`${source.amount ?? source.ticker} to ${destination.amount ?? destination.ticker}`}
    >
      {/*
        Wraps between the legs, never inside one: each leg keeps `nowrap` so an amount is
        never split from its unit, and the break, when one is needed, lands on the arrow.
      */}
      <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <Leg
          ticker={source.ticker}
          amount={source.amount}
          chain={source.chain}
          emphasis={source.ticker === "ZEC" ? "strong" : "normal"}
        />
        <span aria-hidden className="text-ink-faint">
          →
        </span>
        <Leg
          ticker={destination.ticker}
          amount={destination.amount}
          chain={destination.chain}
          emphasis={destination.ticker === "ZEC" ? "strong" : "normal"}
        />
      </span>
      {venueChain !== null || counterpartIsSynthetic ? (
        <span className="text-[10px] text-ink-faint">
          {venueChain !== null ? `on ${venueChain}` : null}
          {venueChain !== null && counterpartIsSynthetic ? " · " : null}
          {/* "1 ZEC" and "1 wrapped ZEC" are not the same claim — a synthetic counterpart
              is a redeemable token, not the asset, and has to say so. */}
          {counterpartIsSynthetic ? "wrapped" : null}
        </span>
      ) : null}
    </span>
  );
}
