import type { TxTypeName } from "@/domain";
import { Badge, type BadgeTone } from "@/components/Badge";
import { SHIELD } from "@/components/PrivacyShield";

export type { TxTypeName };

export interface PoolBadgeProps {
  pool: TxTypeName;
  /**
   * Draw the shield grammar inside the chip: filled for a shielded pool, outline for
   * transparent, nothing for `mined`/`coinbase` (issuance is not cryptography). Off by default:
   * a table column already carries a `PrivacyShield` per row, and a second one inside every
   * chip would say the same thing twice. On in the transaction-action sentence, where the chip
   * stands alone in prose.
   */
  shield?: boolean;
  /**
   * `chip` (the default) is the bordered badge. `text` is the same word in the same ink with no
   * box — the DIRECTION column's form, where several boxes per row would be noise and the ink
   * weight already carries the privacy grammar. The TYPE pill beside it stays boxed.
   */
  variant?: "chip" | "text";
}

/**
 * Ink weight per type. Not decoration — this is the privacy grammar applied to the pools.
 *
 * Green means privacy in this palette, so the ramp says something true: the current shielded
 * protocols carry the full accent; Sapling, the previous one, sits a step back; Sprout is faint
 * because it is the 2016 legacy pool. Transparent gets no green at all — neutral ink for the
 * absence of shielding — and coinbase likewise, since newly minted coin is transparent.
 *
 * A reader scanning the column sees the strength of the cryptography without reading a word.
 * Every tone clears WCAG AA against the panel (`green` 14.1:1, `green-dim` 5.8:1, `ink-dim`
 * 8.9:1, `ink-faint` 5.1:1); `green-faint` is deliberately absent because at 1.9:1 it fails as
 * text.
 */
const toneFor: Record<TxTypeName, BadgeTone> = {
  // Newest pool of all (NU6.3), so it sits at the top of the ramp with Orchard.
  ironwood: "accent",
  orchard: "accent",
  sapling: "dim",
  sprout: "faint",
  transparent: "neutral",
  coinbase: "neutral",
  // Issuance, not cryptography: newly created value has earned no green either.
  mined: "neutral",
};

/** The same ramp as ink alone, for the borderless `text` form. Pinned against `toneFor`. */
export const POOL_INK: Record<TxTypeName, string> = {
  ironwood: "text-green",
  orchard: "text-green",
  sapling: "text-green-dim",
  sprout: "text-ink-faint",
  transparent: "text-ink-dim",
  coinbase: "text-ink-dim",
  mined: "text-ink-dim",
};

/** Which shield a chip draws when asked to: the privacy grammar, per type. */
const shieldFor: Record<TxTypeName, "filled" | "outline" | null> = {
  ironwood: "filled",
  orchard: "filled",
  sapling: "filled",
  sprout: "filled",
  transparent: "outline",
  coinbase: null,
  mined: null,
};

function ShieldMark({ drawn }: { drawn: "filled" | "outline" }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-2.5 w-2.5 shrink-0">
      <path
        d={SHIELD}
        fill={drawn === "filled" ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PoolBadge({ pool, shield = false, variant = "chip" }: PoolBadgeProps) {
  const drawn = shield ? shieldFor[pool] : null;
  const icon = drawn === null ? undefined : <ShieldMark drawn={drawn} />;

  if (variant === "text") {
    return (
      <span
        className={`inline-flex items-center gap-1 text-[10px] leading-4 tracking-[0.14em] whitespace-nowrap uppercase ${POOL_INK[pool]}`}
      >
        {icon}
        {pool}
      </span>
    );
  }

  return (
    <Badge tone={toneFor[pool]} icon={icon}>
      {pool}
    </Badge>
  );
}
