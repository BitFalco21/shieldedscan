import type { Transaction } from "@/domain";
import { txKindLabel } from "@/domain";
import { Badge } from "@/components/Badge";
import { PrivacyShield, privacyVariantFor } from "@/components/PrivacyShield";

export interface KindPillProps {
  tx: Transaction;
}

/**
 * The TYPE column's pill: the transaction's kind as a word, with the shield beside it.
 *
 * On the shared `Badge`, so it is the same height as every pool chip beside it. It keeps a
 * boxed outline: in a row whose DIRECTION pools are plain text, this is the one box, and it
 * names the kind.
 */
export function KindPill({ tx }: KindPillProps) {
  return (
    <Badge tone="outline" icon={<PrivacyShield variant={privacyVariantFor(tx)} />}>
      {txKindLabel(tx)}
    </Badge>
  );
}
