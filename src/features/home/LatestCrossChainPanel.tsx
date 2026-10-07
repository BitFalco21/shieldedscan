import Link from "@/components/Link";
import type { CrossChainTransfer } from "@/domain";
import { protocolLabel } from "@/domain";
import { ChainRoute } from "@/components/ChainRoute";
import { Panel } from "@/components/Panel";
import { liveRowClass } from "@/lib/live-row";
import { StatusPill } from "@/components/StatusPill";

export interface LatestCrossChainPanelProps {
  transfers: CrossChainTransfer[];
  /** Transfer ids that arrived on the most recent poll. Empty on a server render. */
  freshIds?: readonly string[];
}

export function LatestCrossChainPanel({ transfers, freshIds = [] }: LatestCrossChainPanelProps) {
  const fresh = new Set(freshIds);
  return (
    <Panel
      fill
      title="LATEST CROSS-CHAIN"
      action={
        <Link
          href="/cross-chain"
          className="text-[10px] tracking-widest text-ink-dim hover:text-green"
        >
          see all →
        </Link>
      }
    >
      <ul className="grid h-full auto-rows-fr">
        {transfers.map((transfer) => (
          <li
            key={transfer.id}
            className={liveRowClass("hairline-b last:border-0", fresh.has(transfer.id))}
          >
            {/*
              Two lines: the route needs horizontal room for four elements. `ChainRoute`
              carries both legs' amounts, so the ZEC figure is not repeated beside it.
            */}
            <Link
              href={`/cross-chain/${transfer.id}`}
              aria-label={`Transfer ${transfer.id}`}
              className="row-hover block h-full rounded-sm px-1 py-3"
            >
              <span className="flex items-start justify-between gap-3">
                <ChainRoute transfer={transfer} />
                <StatusPill status={transfer.status} />
              </span>
              <span className="mt-1.5 block text-[11px] text-ink-faint">
                {protocolLabel(transfer.protocol)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
