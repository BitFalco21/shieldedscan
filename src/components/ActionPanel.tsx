import type { ReactNode } from "react";
import type { ActionPart } from "@/domain";
import { ActionSentence } from "@/components/ActionSentence";
import { PrivacyShield, type PrivacyVariant } from "@/components/PrivacyShield";

export interface ActionPanelProps {
  /** The shield grammar for an on-chain transaction; `swap` for a crossing between chains. */
  icon: PrivacyVariant | "swap";
  parts: readonly ActionPart[];
  /** ZEC's dollar price for the action's day: every public ZEC amount is valued beside itself. */
  zecUsd?: number;
  /**
   * What the chain does not record about this action, said rather than left to inference.
   * Omitted where that caveat belongs elsewhere: a cross-chain transfer's far-side note sits in
   * a tip beside the foreign leg's label instead.
   */
  limit?: string;
  /** `NOT ON CHAIN` by default; a coinbase withholds nothing and says `ON CHAIN`. */
  limitLabel?: string;
  /**
   * Lines another source states about an event that came BEFORE this action, drawn inside its
   * box above the sentence: a swap into Zcash this transaction paid out.
   */
  lead?: ReactNode;
  /**
   * Lines another source states about an event that came AFTER this action, drawn inside its box
   * under the sentence: a swap out of Zcash this transaction deposited for.
   */
  children?: ReactNode;
  className?: string;
}

/**
 * What a transaction (or a crossing) did, in one sentence inside one box.
 *
 * The sentence says what happened; the closing line says what the chain does not record. Kept
 * as separate lines so the caveat does not read as the tail of a description.
 */
export function ActionPanel({
  icon,
  parts,
  zecUsd,
  limit,
  limitLabel = "NOT ON CHAIN",
  lead,
  children,
  className = "",
}: ActionPanelProps) {
  return (
    <section aria-label="What happened" className={`panel ${className}`}>
      {lead}
      <div className="flex items-start gap-3 px-4 py-3 sm:px-5">
        <span className="mt-2.5 shrink-0">
          {icon === "swap" ? (
            <svg
              role="img"
              aria-label="a crossing between chains"
              viewBox="0 0 24 24"
              className="h-3.5 w-3.5 text-ink-dim"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            >
              <path d="M4 12h15M15 8l4 4-4 4M12 3v3M12 18v3" />
            </svg>
          ) : (
            <PrivacyShield variant={icon} />
          )}
        </span>
        <div className="min-w-0">
          <ActionSentence parts={parts} zecUsd={zecUsd} />
        </div>
      </div>
      {children}
      {/* Inline, not flex: a flex row discards the whitespace-only text node, and the label
          would then copy as one word with the sentence ("NOT ON CHAINWhich output…"). */}
      {limit === undefined ? null : (
        <p className="border-t border-dashed border-edge-faint px-4 py-2.5 text-xs leading-relaxed text-ink-dim sm:px-5">
          <span className="microlabel mr-2 text-green-dim">{limitLabel}</span> {limit}
        </p>
      )}
    </section>
  );
}
