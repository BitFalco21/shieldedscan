import type { CrossChainStatus } from "@/domain";
import { statusGlyph, statusLabel } from "@/domain";
import { Badge, type BadgeTone } from "@/components/Badge";

/** Completed is in force (accent); pending is not settled yet (dashed); refunded was undone. */
const variant: Record<CrossChainStatus, { tone: BadgeTone; dashed: boolean }> = {
  completed: { tone: "accent", dashed: false },
  pending: { tone: "outline", dashed: true },
  refunded: { tone: "faint", dashed: false },
};

export interface StatusPillProps {
  status: CrossChainStatus;
}

export function StatusPill({ status }: StatusPillProps) {
  const { tone, dashed } = variant[status];
  return (
    <Badge tone={tone} dashed={dashed} icon={<span aria-hidden>{statusGlyph(status)}</span>}>
      {statusLabel(status)}
    </Badge>
  );
}
