import type { SupplyPart } from "@/domain";
import { PrivacyShield } from "@/components/PrivacyShield";
import { Unmeasured } from "@/components/Unmeasured";
import { formatSharePct, formatZec, formatZecSupply } from "@/lib/format";
import type { SupplyPartMeta } from "./supply-part-meta";
import { SupplyPartKey } from "./SupplyPartKey";

export interface SupplyPartCardProps {
  part: SupplyPart;
  meta: SupplyPartMeta;
  /** The card's share of its `meta.denominator`, or null when that is unknown. */
  sharePct: number | null;
  selected: boolean;
  onSelect: () => void;
  /** The id of the panel the card opens. */
  controls: string;
}

/**
 * One place a ZEC can be: its balance and its share, as a button that opens its panel below.
 * The selection is stated by `aria-pressed` and the border together, never by colour alone.
 */
export function SupplyPartCard({
  part,
  meta,
  sharePct,
  selected,
  onSelect,
  controls,
}: SupplyPartCardProps) {
  const of = meta.denominator === "cap" ? "of 21M" : "of issued";
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-controls={controls}
      onClick={onSelect}
      className={`panel flex cursor-pointer flex-col gap-1.5 px-4 py-3 text-left transition-colors sm:min-h-32 ${
        selected ? "border-green bg-green-wash" : "hover:border-edge-strong"
      }`}
    >
      <span className="flex w-full items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          {/* The bar's key, so a card and its segment are found by colour; the shield, where
              there is one, says the privacy kind by shape. */}
          <SupplyPartKey ink={meta.ink} />
          {meta.privacy === null ? null : <PrivacyShield variant={meta.privacy} />}
          <span className="microlabel text-ink-bright">{meta.label}</span>
        </span>
        <span className="text-right text-xs text-ink-faint">{meta.tag}</span>
      </span>
      <span
        className="text-lg font-bold tracking-tight text-ink-bright tabular-nums"
        title={part.zat === null ? undefined : formatZec(part.zat)}
      >
        {part.zat === null ? <Unmeasured /> : formatZecSupply(part.zat)}
      </span>
      <span className="text-xs text-ink-dim tabular-nums">
        {sharePct === null ? (
          <>
            share <Unmeasured />
          </>
        ) : (
          `${formatSharePct(sharePct)} ${of}`
        )}
      </span>
      <span className="mt-auto text-xs text-green">{selected ? "Shown below ↓" : "Details →"}</span>
    </button>
  );
}
