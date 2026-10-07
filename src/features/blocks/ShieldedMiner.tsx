import { REDACTION_GLYPH } from "@/components/Redacted";

export interface ShieldedMinerProps {
  /** The bar's width, in redaction glyphs. */
  glyphs: number;
}

/**
 * The miner of a block whose coinbase paid a shielded address: redacted rather than blanked,
 * because the payee is unknowable by design and that is a fact about Zcash worth stating in the
 * ink the rest of the explorer uses for it.
 */
export function ShieldedMiner({ glyphs }: ShieldedMinerProps) {
  return (
    <span
      role="img"
      aria-label="miner shielded — the block reward was paid to a shielded address"
      title="hidden by design — the block reward was paid to a shielded address"
      className="redact text-xs"
    >
      {REDACTION_GLYPH.repeat(glyphs)}
    </span>
  );
}
