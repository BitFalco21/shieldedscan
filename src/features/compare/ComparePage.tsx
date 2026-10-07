import type { ComparisonSelection, MarketAsset, MarketSnapshot } from "@/domain";
import { eligibleAssets, zecShareOfCounterpartPct } from "@/domain";
import { ChainLogo } from "@/components/ChainLogo";
import { DataUnavailable } from "@/components/DataUnavailable";
import {
  formatMultiple,
  formatSharePct,
  formatUsdCompact,
  formatUsdExact,
  formatUtc,
} from "@/lib/format";
import { AssetPicker } from "./AssetPicker";
import { CompareHeader } from "./CompareHeader";
import { CompareTabs } from "./CompareTabs";
import { CoinCard } from "./CoinCard";
import { ShareBar } from "@/components/ShareBar";

export interface ComparePageProps {
  /** Null when the upstream snapshot is missing or too old to be honest. */
  snapshot: MarketSnapshot | null;
  selection: ComparisonSelection;
}

/**
 * The formula, read left to right across the top of the two cards: Zcash · with the market
 * cap of · Bitcoin. The first line anyone reads and the one line a cropped screenshot keeps,
 * so both assets are named here at 34px with their marks, before either card and before the
 * figure. Never "with the price of": at Bitcoin's price one ZEC would be $63,963, a different
 * and false claim.
 */
function Formula({ zec, other }: { zec: MarketAsset; other: MarketAsset }) {
  return (
    <div className="grid items-center gap-x-4 gap-y-1.5 text-center sm:grid-cols-[1fr_auto_1fr]">
      <div className="flex items-center justify-center gap-3 text-[28px] leading-none font-bold tracking-tight text-green">
        <ChainLogo chain={zec.symbol} fallbackChain={zec.id} size="lg" />
        {zec.name}
      </div>
      <div className="text-[13px] tracking-[0.2em] text-ink-dim uppercase">
        with the market cap of
      </div>
      <div className="flex items-center justify-center gap-3 text-[28px] leading-none font-bold tracking-tight text-ink-bright">
        <ChainLogo chain={other.symbol} fallbackChain={other.id} size="lg" />
        {other.name}
      </div>
    </div>
  );
}

/**
 * Zcash's cap as a share of the other asset's, drawn.
 *
 * Allowed because both terms are printed beside it and the percentage carries its denominator.
 * It is a share, never a path or a prediction; the label says "against", not "to". The width is
 * an SVG attribute, with a 0.4-unit floor so a real cap never renders as nothing.
 */
function CapShareBar({ zec, other, pct }: { zec: MarketAsset; other: MarketAsset; pct: number }) {
  return (
    <div className="mx-auto mt-6 max-w-2xl text-left">
      <div className="flex justify-between text-[11px] tracking-[0.14em] text-ink-faint uppercase">
        <span>{`${zec.name}'s market cap against ${other.name}'s`}</span>
        <span className="text-ink-dim">{formatSharePct(pct, 2)}</span>
      </div>
      <ShareBar
        pct={pct}
        floor={0.4}
        height={1}
        className="mt-2 block h-2 w-full overflow-hidden rounded-sm"
        trackClassName="fill-green-faint"
        fillClassName="fill-green"
      />
      <div className="mt-2 flex justify-between text-xs text-ink-dim tabular-nums">
        <span>
          <b className="font-medium text-ink">{formatUsdCompact(zec.marketCapUsd)}</b> {zec.name}
        </span>
        <span>
          <b className="font-medium text-ink">{formatUsdCompact(other.marketCapUsd)}</b>{" "}
          {other.name}
        </span>
      </div>
    </div>
  );
}

/**
 * What the page says when the URL named an asset it will not compare against.
 *
 * Stated rather than silently replaced with Bitcoin: substituting a different asset under the
 * same URL would leave a reader of a stale link reading a comparison they never asked for.
 */
function NotCompared({ heading, detail }: { heading: string; detail: string }) {
  return (
    <div className="panel px-6 py-8 text-center">
      <div className="microlabel text-warn">{heading}</div>
      <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-ink-dim">{detail}</p>
    </div>
  );
}

/** The attribution, as one line: the only page here whose numbers the chain cannot check. */
function Attribution({ asOf }: { asOf: number }) {
  return (
    <p className="mt-5 text-[11px] tracking-[0.06em] text-ink-faint">
      {`CoinGecko · read ${formatUtc(asOf)} · refreshed every few minutes · both sides, one source · arithmetic, not a forecast`}
    </p>
  );
}

export function ComparePage({ snapshot, selection }: ComparePageProps) {
  const assets = snapshot === null ? [] : eligibleAssets(snapshot);
  const selected = selection.kind === "comparison" ? selection.comparison.counterpart : null;
  const picker = <AssetPicker assets={assets} selected={selected} />;

  return (
    <>
      <CompareHeader />

      <CompareTabs active="comparison" />

      {snapshot === null ? (
        <DataUnavailable what="Market capitalisations" refreshesWithin="a few minutes" />
      ) : selection.kind === "comparison" ? (
        <section
          className="flex flex-col gap-4"
          aria-label={`One ZEC at ${selection.comparison.counterpart.name}'s market capitalisation`}
        >
          <Formula zec={snapshot.zec} other={selection.comparison.counterpart} />

          {/*
           * Coin A left, coin B right, the arrow between them. The picker lives INSIDE the
           * right card — the control sits where the thing it changes is drawn — and it is
           * anchored left, which is safe here at every width: stacked below `sm` the card
           * starts at the content's left edge, and side by side the card is wide enough to
           * hold the panel.
           */}
          <div className="grid items-stretch gap-4 sm:grid-cols-[1fr_auto_1fr]">
            <CoinCard asset={snapshot.zec} role="fixed">
              <div className="rounded-sm border border-dashed border-edge-faint px-3 py-2 text-xs text-ink-faint">
                always Zcash — this page prices ZEC, nothing else
              </div>
            </CoinCard>
            <div
              className="flex items-center justify-center text-[32px] leading-none text-green-dim sm:w-12"
              aria-hidden
            >
              <span className="inline-block rotate-90 sm:rotate-0">→</span>
            </div>
            <CoinCard asset={selection.comparison.counterpart} role="choose">
              {picker}
            </CoinCard>
          </div>

          <div className="panel px-6 py-7 text-center">
            <div className="microlabel text-ink-faint">ONE ZEC WOULD BE WORTH</div>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
              <span className="compare-figure text-[44px] sm:text-[72px]">
                {formatUsdExact(selection.comparison.impliedPriceUsd)}
              </span>
              <span className="inline-flex items-baseline gap-1.5 rounded-sm border border-edge-strong px-3.5 py-2 font-mono text-[26px] font-medium tracking-tight text-green">
                <span>{formatMultiple(selection.comparison.multiple)}</span>
                <span className="microlabel text-ink-dim">current price</span>
              </span>
            </div>
            {/*
             * One template string, not prose interleaved with `{…}`: a literal space after an
             * expression container is dropped when the line is rewrapped.
             */}
            <p className="mt-3 text-xs text-ink-faint">
              {`from ${formatUsdExact(snapshot.zec.priceUsd)} today · Zcash's circulating supply held fixed · ${
                selection.comparison.counterpart.name
              }'s market capitalisation is ${formatMultiple(selection.comparison.multiple)} Zcash's`}
            </p>

            <CapShareBar
              zec={snapshot.zec}
              other={selection.comparison.counterpart}
              pct={zecShareOfCounterpartPct(selection.comparison)}
            />

            <Attribution asOf={snapshot.asOf} />
          </div>
        </section>
      ) : (
        <div className="flex flex-col gap-4">
          {/*
           * A miss keeps the shape: Zcash's card stays, and the right card is the picker, so
           * the page is never a dead end. The reason the link stopped working is stated below
           * the cards rather than dressed as a comparison.
           */}
          <div className="grid items-stretch gap-4 sm:grid-cols-[1fr_auto_1fr]">
            <CoinCard asset={snapshot.zec} role="fixed" />
            <div
              className="flex items-center justify-center text-[32px] leading-none text-green-dim sm:w-12"
              aria-hidden
            >
              <span className="inline-block rotate-90 sm:rotate-0">→</span>
            </div>
            <div className="panel flex flex-col items-center justify-center gap-3 border-edge-strong px-5 py-7 text-center">
              <span className="microlabel text-ink-faint">coin B · choose</span>
              {picker}
            </div>
          </div>

          {selection.kind === "smaller" ? (
            <NotCompared
              heading="NOT A LARGER ASSET"
              detail={`${selection.asset.name}'s market capitalisation is ${formatUsdCompact(
                selection.asset.marketCapUsd,
              )}, below Zcash's ${formatUsdCompact(
                snapshot.zec.marketCapUsd,
              )}. This page compares Zcash against assets larger than it, so there is nothing to show here — pick one from the card above.`}
            />
          ) : selection.kind === "not-comparable" ? (
            <NotCompared
              heading="NOT COMPARED"
              detail={`${selection.asset.name} is larger than Zcash, but its market capitalisation is not a valuation of a freely-traded asset — a stablecoin's is its float and a tokenised fund's is its book. Comparing Zcash to one would answer a question nobody asked.`}
            />
          ) : selection.kind === "unknown" ? (
            <NotCompared
              heading="NOT FOUND"
              detail="No asset by that name is in this snapshot. Pick one from the card above."
            />
          ) : (
            <NotCompared
              heading="NOTHING TO COMPARE"
              detail="No asset in this snapshot has a larger market capitalisation than Zcash."
            />
          )}
          <p className="text-[11px] tracking-[0.06em] text-ink-faint">
            {`CoinGecko · read ${formatUtc(snapshot.asOf)} · refreshed every few minutes`}
          </p>
        </div>
      )}
    </>
  );
}
