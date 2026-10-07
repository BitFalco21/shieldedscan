import { assetTickerIsKnown } from "@/domain";
import { Badge } from "@/components/Badge";
import { ChainLogo } from "@/components/ChainLogo";
import { CopyButton } from "@/components/CopyButton";
import { chainName } from "@/lib/chains";
import { formatUsdExact, shortHash } from "@/lib/format";

/**
 * One end of a cross-chain transfer: the chain, what moved, and whose address it moved from
 * or to.
 *
 * Both ends use the same component so the two sides of a route are visually symmetric.
 *
 * `amount` is pre-formatted by the caller: the Zcash side formats zatoshis, the far side is
 * decimal asset units, and this component does not need to know which.
 */
export interface TransferLegProps {
  chain: string;
  /** Pre-formatted; `null` when the venue has not published this leg's amount yet. */
  amount: string | null;
  asset: string;
  /**
   * Undefined as well as null: an API deployed before the frontend omits the field, and JSON
   * cannot send `undefined`. Treating only `null` as absent would crash on ordinary deploy skew.
   */
  address: string | null | undefined;
  /** `from` on the source side, `to` on the destination side. */
  role: "from" | "to";
  /**
   * The venue's published USD value of THIS leg at swap time; null renders nothing. The
   * two legs' figures differ slightly by the venue's fee — that gap is real, so the sides
   * are never averaged into one number.
   */
  usdAtSwap?: number | null;
  /**
   * The asset is a wrapped claim, not the asset itself. Labelled rather than hidden:
   * ZEC and wrapped ZEC are different claims, and a reader must not have to infer which
   * one a row means from the chain name.
   */
  synthetic?: boolean;
  /** Link the address (Zcash addresses have a page here; foreign ones do not). */
  href?: string | null;
}

export function TransferLeg({
  chain,
  amount,
  asset,
  address,
  role,
  usdAtSwap = null,
  href = null,
  synthetic = false,
}: TransferLegProps) {
  return (
    <div className="flex flex-col gap-1">
      {/*
        The chain name is hidden on a phone, the mark is not: beside a ticker the name is the
        one redundant token in the row, and dropping it keeps the row's link column on screen
        at 390px. The name stays in the accessibility tree.
      */}
      <div className="flex items-center gap-2">
        <ChainLogo chain={chain} />
        <span className="sr-only text-sm sm:not-sr-only">{chainName(chain)}</span>
      </div>

      {/*
        Mark between the number and the ticker — "4.901 ◎ SOL" — so it sits with the thing it
        identifies and the numbers left-align down the column.
      */}
      {/*
        The number and its mark are one token and never break; the ticker and the USD figure
        beside them still may. Making the whole line `nowrap` would widen the table past a
        phone. Group the atoms, do not forbid the wrap.
      */}
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 font-mono text-xs">
        <span className="inline-flex items-center gap-x-1.5 whitespace-nowrap">
          {amount === null ? (
            <span className="text-ink-faint">not settled</span>
          ) : (
            <span className="font-semibold tabular-nums">{amount}</span>
          )}
          {/* Falls back to the chain's mark: when a venue never published the token's
            ticker, `asset` is a placeholder phrase and has no brand of its own, but the
            chain it sat on does — and that is a true statement about the row. */}
          <ChainLogo chain={asset} fallbackChain={chain} emphasis="normal" />
          {/* A known ticker joins the atom — "0.15 ◆ ETH" is one quantity and must not break
              across lines. The unidentified-token phrase stays outside it: it is a sentence,
              not a symbol. */}
          {assetTickerIsKnown(asset) ? <span className="text-ink-dim">{asset}</span> : null}
        </span>
        {assetTickerIsKnown(asset) ? null : (
          // Never the chain's native ticker in its place — an SPL token on Solana is not
          // SOL, and saying so would be a fabricated identification.
          <span
            className="text-ink-faint italic"
            title={`The swap record identifies this token only by its contract address on ${chainName(chain)}, so its ticker is not known.`}
          >
            unidentified token
          </span>
        )}
        {synthetic ? <Badge tone="faint">WRAPPED</Badge> : null}
        {/*
          The venue's own figure for this leg at swap time. "at swap" lives in the tooltip
          rather than on every leg: a historical figure and a live quote are different things,
          and the `≈` alone does not say which this is.

          `whitespace-nowrap` keeps the "≈" from wrapping away from its number on a phone.
        */}
        {usdAtSwap !== null ? (
          <span
            className="text-[10px] whitespace-nowrap text-ink-faint tabular-nums"
            title="The venue's published USD value of this leg at the time of the swap — not a live quote."
          >
            ≈ {formatUsdExact(usdAtSwap)}
          </span>
        ) : null}
      </div>

      {/*
        Hidden on a phone: a six-character elision of a 42-character address cannot be verified
        or recognised at that width, and the detail page one tap away shows it in full.
      */}
      <div className="hidden items-center gap-1 font-mono text-[11px] text-ink-faint sm:flex">
        <span>{role}</span>
        {address == null ? (
          <em className="not-italic">not published</em>
        ) : (
          <>
            {href ? (
              <a href={href} className="text-ink-dim hover:underline">
                {shortHash(address, 6)}
              </a>
            ) : (
              <span className="text-ink-dim" title={address}>
                {shortHash(address, 6)}
              </span>
            )}
            <CopyButton value={address} label={`${role} address`} />
          </>
        )}
      </div>
    </div>
  );
}
