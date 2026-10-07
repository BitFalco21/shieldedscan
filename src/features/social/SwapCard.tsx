import { ZATS_PER_ZEC } from "@/domain";
import {
  formatCounterpartAmount,
  formatSwapUsdAtSwap,
  swapCounterpartLabel,
  swapDirection,
  swapIsComplete,
  type SwapFigures,
} from "@/domain/swap";
import { brandMark, canonicalMarkTicker } from "@/components/brand-marks";
import { elideCardTxid, formatCardDate } from "./card-format";

export interface SwapCardProps {
  figures: SwapFigures;
}

/**
 * A swap card's own ZEC figure, at a fixed two decimals: a headline figure on a card built for
 * large type, not a ledger amount (that is `formatZecAmount`'s eight-decimal job). Every swap
 * the card can post clears the poster's USD floor (at least $10,000), so a real amount
 * rounding to "0.00" is not reachable here.
 */
function formatCardZecAmount(zat: number): string {
  const zec = zat / ZATS_PER_ZEC;
  return zec.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * The venue's own mark, by its display name (`SwapFigures.venue` is `protocolLabel(p)`, never
 * a slug), keyed the way `ProtocolLogo`'s `PROTOCOL_MARK` is. A venue absent from this table
 * falls back to `Mark`'s lettermark of its display name, never a substituted mark.
 */
const VENUE_MARK_TICKER: Record<string, string> = {
  "NEAR Intents": "NEAR",
  "Maya Protocol": "MAYA",
  THORChain: "THOR",
};

/**
 * A brand mark or asset mark at an arbitrary pixel size.
 *
 * `ChainLogo`/`ProtocolLogo` size marks through a fixed class built for a table row's icon.
 * This card's marks run from 24px to 150px, so this renders the same `brand-marks.ts` data at
 * the size the design calls for, via SVG `width`/`height` attributes.
 *
 * Deliberately no fallback to another ticker's mark, unlike `ChainLogo`: at 150px directly
 * above the asset's name, a chain's mark would claim an identity that is not the asset's (an
 * SPL token on Solana is not SOL). An unidentified asset keeps the ink lettermark.
 */
function Mark({ ticker, px }: { ticker: string; px: number }) {
  const mark = brandMark(ticker);
  const marked = canonicalMarkTicker(ticker) ?? ticker;

  if (mark === null) {
    return (
      <svg aria-hidden width={px} height={px} viewBox="0 0 32 32" className="text-ink">
        <circle cx={16} cy={16} r={15} fill="none" stroke="currentColor" strokeWidth={1.5} />
        <text x={16} y={21} textAnchor="middle" fontSize={14} fontWeight={700} fill="currentColor">
          {marked.slice(0, 1).toUpperCase()}
        </text>
      </svg>
    );
  }

  return (
    <svg
      aria-hidden
      width={px}
      height={px}
      viewBox={mark.viewBox}
      className={`brand-${marked.toLowerCase()}`}
      fill={mark.strokeWidth === undefined ? "currentColor" : "none"}
    >
      <g transform={mark.transform}>
        <path
          d={mark.d}
          {...(mark.fillRule === undefined ? {} : { fillRule: mark.fillRule })}
          {...(mark.strokeWidth === undefined
            ? {}
            : {
                stroke: "currentColor",
                strokeWidth: mark.strokeWidth,
                strokeLinecap: "round" as const,
                strokeLinejoin: "round" as const,
              })}
        />
      </g>
    </svg>
  );
}

export function SwapCard({ figures }: SwapCardProps) {
  // The single completeness gate: this must call `swapIsComplete`, never restate part of it.
  if (!swapIsComplete(figures)) {
    throw new Error("SwapCard rendered from an incomplete crossing");
  }
  // Non-null assertions, not a second decision: `swapIsComplete` just guaranteed both of
  // these, so there is nothing left to check, only to unwrap.
  const usdAtSwap = figures.usdAtSwap!;
  const counterpartLabel = swapCounterpartLabel(figures)!;
  const venueTicker = VENUE_MARK_TICKER[figures.venue] ?? figures.venue;
  // The heading and both cells follow the direction: flipping only the words would leave the
  // arrow pointing from destination to source, the crossing stated backwards.
  const inbound = swapDirection(figures) === "in";

  const counterpartSide = (
    <div
      role="group"
      aria-label={counterpartLabel}
      className="card-swap-side flex flex-col items-center"
    >
      <Mark ticker={figures.counterpartAsset} px={150} />
      <div className="mt-6 text-[66px] leading-none text-ink-bright tabular-nums">
        {formatCounterpartAmount(figures.counterpartAmount)}
      </div>
      <div className="microlabel mt-3 text-[19px]">{figures.counterpartAsset}</div>
      {!figures.counterpartIsNative && (
        <div className="mt-4 flex items-center gap-2">
          <Mark ticker={figures.counterpartChain} px={24} />
          <span className="microlabel text-[19px] text-ink-faint">
            ON {figures.counterpartChainName}
          </span>
        </div>
      )}
    </div>
  );

  const zecSide = (
    <div
      role="group"
      aria-label={`${formatCardZecAmount(figures.zecAmountZat)} ZEC on Zcash`}
      className="card-swap-side flex flex-col items-center"
    >
      <Mark ticker="ZEC" px={150} />
      <div className="mt-6">
        <span className="crt-digit text-[66px] leading-none font-extrabold tabular-nums">
          {formatCardZecAmount(figures.zecAmountZat)}
        </span>
      </div>
      <div className="microlabel mt-3 text-[19px]">ZEC</div>
      <div className="mt-4 flex items-center gap-2">
        <Mark ticker="ZEC" px={24} />
        <span className="microlabel text-[19px] text-ink-faint">ON Zcash</span>
      </div>
    </div>
  );

  return (
    // `data-social-card` is the X poster's screenshot hook, as in `DailyCard`.
    <div className="card-swap" data-social-card>
      <header className="flex items-baseline justify-between">
        <span className="text-[26px] font-bold text-green">
          ./shieldedscan
          <i aria-hidden className="cursor-block logo-cursor ml-1" />
        </span>
        <span className="microlabel text-[19px]">{formatCardDate(figures.timestamp)}</span>
      </header>

      <div className="flex items-baseline gap-5">
        <span className="text-[34px] font-bold tracking-wide text-green">CROSS-CHAIN SWAP</span>
        <span aria-hidden className="text-[30px] leading-none text-green">
          →
        </span>
        <span className="text-[34px] font-bold text-ink-bright">
          {inbound ? "INTO ZCASH" : "OUT OF ZCASH"}
        </span>
      </div>

      <div className="panel flex items-stretch">
        {inbound ? counterpartSide : zecSide}

        <div className="card-swap-crossing">
          <div className="flex w-[200px] items-center gap-3">
            <div className="card-swap-rule flex-1" />
            <span aria-hidden className="text-[40px] leading-none text-green">
              →
            </span>
          </div>
          <div className="mt-6 flex items-center gap-3">
            <Mark ticker={venueTicker} px={30} />
            <span className="microlabel text-[19px] text-ink-dim">{figures.venue}</span>
          </div>
        </div>

        {inbound ? zecSide : counterpartSide}
      </div>

      <div className="flex items-baseline gap-7">
        <span className="crt-digit text-[104px] leading-none font-extrabold tabular-nums">
          {formatSwapUsdAtSwap(usdAtSwap)}
        </span>
        <span className="microlabel text-[19px]">VALUE AT SWAP</span>
      </div>

      <footer className="flex items-baseline justify-between">
        <span className="text-[20px] text-ink-faint">{elideCardTxid(figures.zcashTxid)}</span>
        <span className="text-[22px] text-green-dim">shieldedscan.xyz</span>
      </footer>
    </div>
  );
}
