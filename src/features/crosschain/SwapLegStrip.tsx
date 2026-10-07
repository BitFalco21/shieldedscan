import type { CrossChainTransfer } from "@/domain";
import { ActionSentence } from "@/components/ActionSentence";
import Link from "@/components/Link";
import { transferAction } from "./transferAction";

export interface SwapLegStripProps {
  transfer: CrossChainTransfer;
}

/**
 * "This transaction is the Zcash leg of a swap", on a `/tx` page — the crossing's own action
 * sentence, linked to its transfer page.
 *
 * Dashed, like every mark on this site for something another chain holds: the far leg is the
 * venue's report and is not checked here. The whole strip is one link, and the sentence inside
 * carries no link of its own, so there is exactly one destination and nothing nested.
 */
export function SwapLegStrip({ transfer }: SwapLegStripProps) {
  const action = transferAction(transfer);
  return (
    <Link
      href={`/cross-chain/${transfer.id}`}
      className="panel block border-dashed px-4 py-3 transition-colors hover:border-green-dim sm:px-5"
    >
      {/* One inline line with a real separator, not a flex row: a flex row discards the
          whitespace between items and the two labels would copy as one word. The label uses
          the section-label ink (green-dim); the call to action keeps the accent. */}
      <span className="microlabel block">
        Zcash leg of a swap {transfer.direction === "in" ? "into" : "out of"} Zcash
        <span className="text-ink-faint"> · </span>
        <span className="text-green">view the transfer →</span>
      </span>
      <ActionSentence parts={action.parts} />
    </Link>
  );
}
