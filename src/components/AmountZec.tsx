import { Redacted } from "@/components/Redacted";
import { formatZec } from "@/lib/format";

export interface AmountZecProps {
  zat: number | null;
}

/**
 * A ZEC amount, or the Veil in its inline form: a shielded (`null`) value renders
 * as a glowing redaction bar — never `0`, never `—`, never an empty cell. The
 * accessible name states what the bar means; the glyphs themselves are decoration.
 */
export function AmountZec({ zat }: AmountZecProps) {
  if (zat === null) {
    return <Redacted className="text-xs" />;
  }
  return <span className="font-semibold text-ink-bright tabular-nums">{formatZec(zat)}</span>;
}
