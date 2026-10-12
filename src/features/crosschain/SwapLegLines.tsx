import type { CrossChainTransfer, ZcashTxCrossings } from "@/domain";
import { ActionSentence } from "@/components/ActionSentence";
import Link from "@/components/Link";
import { formatCount } from "@/lib/format";
import { transferAction } from "./transferAction";

export interface SwapLegLinesProps {
  crossings: ZcashTxCrossings;
  /** Above the transaction's sentence (the swap came first) or below it; the rule falls between. */
  placement: "before" | "after";
  /** ZEC's dollar price for the transaction's day, so a swap's ZEC is valued as the sentence's is. */
  zecUsd?: number;
}

/** How many swap lines show before the rest fold away; venues batch, up to 20 seen. */
const SWAP_LINES_SHOWN = 2;

/**
 * The swaps a transaction is the Zcash leg of, as lines inside its action panel, under what the
 * chain shows. Each is the venue's report, its far chain dashed as everything not indexed here
 * is, and its amount can differ from the transaction's (a fee, a venue's change), so it stays a
 * statement of its own rather than a clause of the sentence above.
 *
 * Batches fold: a transaction that settled twenty swaps would otherwise push the rest of the page
 * below the fold. The count is the exact total the API reported, and a list the API capped says
 * so, since a bounded list is only honest beside the number it was cut from.
 */
export function SwapLegLines({ crossings, placement, zecUsd }: SwapLegLinesProps) {
  const { transfers, total } = crossings;
  if (transfers.length === 0) return null;
  const shown = transfers.slice(0, SWAP_LINES_SHOWN);
  const folded = transfers.slice(SWAP_LINES_SHOWN);
  // Counted from the total, not the list: an API that capped the list still reported every swap.
  const more = total - shown.length;
  return (
    <div
      className={`border-dashed border-edge-faint ${placement === "before" ? "border-b" : "border-t"}`}
    >
      {shown.map((transfer) => (
        <SwapLegLine key={transfer.id} transfer={transfer} zecUsd={zecUsd} />
      ))}
      {more > 0 ? (
        <details className="border-t border-dashed border-edge-faint px-4 py-2.5 sm:px-5">
          <summary className="disclosure microlabel text-green">
            {formatCount(more)} more {more === 1 ? "swap" : "swaps"} settled by this transaction
          </summary>
          <div className="-mx-4 mt-2 sm:-mx-5">
            {folded.map((transfer) => (
              <SwapLegLine key={transfer.id} transfer={transfer} zecUsd={zecUsd} />
            ))}
          </div>
          {transfers.length < total ? (
            <p className="mt-2 text-xs text-ink-faint">
              Showing {transfers.length} of {formatCount(total)} swaps.
            </p>
          ) : null}
        </details>
      ) : null}
    </div>
  );
}

/** One swap: which way it crossed and where its page is, then the venue's sentence. */
function SwapLegLine({ transfer, zecUsd }: { transfer: CrossChainTransfer; zecUsd?: number }) {
  const action = transferAction(transfer);
  return (
    <div className="flex items-start gap-3 px-4 py-3 not-first:border-t not-first:border-dashed not-first:border-edge-faint sm:px-5">
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        className="mt-1 h-3.5 w-3.5 shrink-0 text-ink-dim"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      >
        <path d="M4 12h15M15 8l4 4-4 4M12 3v3M12 18v3" />
      </svg>
      <div className="min-w-0 flex-1">
        {/* One inline line with a real separator: a flex row would discard the whitespace and
            the label and link would copy as one word. */}
        <p className="microlabel">
          Swap {transfer.direction === "in" ? "into" : "out of"} Zcash
          <span className="text-ink-faint"> · </span>
          <Link href={`/cross-chain/${transfer.id}`} className="text-green hover:text-ink-bright">
            view the transfer →
          </Link>
        </p>
        <ActionSentence parts={action.parts} zecUsd={zecUsd} />
      </div>
    </div>
  );
}
