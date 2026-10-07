import type { BlockSummary } from "@/domain";
import { Panel } from "@/components/Panel";
import { liveRowClass } from "@/lib/live-row";
import { formatBytes, formatCount, timeAgo } from "@/lib/format";
import Link from "@/components/Link";

export interface LatestBlocksPanelProps {
  blocks: BlockSummary[];
  now: number;
  /** Hashes that arrived on the most recent poll. Empty on a server render. */
  freshIds?: readonly string[];
}

export function LatestBlocksPanel({ blocks, now, freshIds = [] }: LatestBlocksPanelProps) {
  const fresh = new Set(freshIds);
  return (
    <Panel
      fill
      title="LATEST BLOCKS"
      action={
        <Link href="/blocks" className="text-[10px] tracking-widest text-ink-dim hover:text-green">
          see all →
        </Link>
      }
    >
      <ul className="grid h-full auto-rows-fr">
        {blocks.map((b) => (
          <li
            key={b.hash}
            className={liveRowClass("hairline-b text-sm last:border-0", fresh.has(b.hash))}
          >
            {/* Whole row is the link — same affordance as the neighbouring panels. */}
            <Link
              href={`/block/${b.height}`}
              className="row-hover flex h-full items-center gap-3 rounded-sm px-1 py-2.5"
            >
              <span className="font-semibold whitespace-nowrap text-green tabular-nums">
                #{formatCount(b.height)}
              </span>
              <span className="text-xs whitespace-nowrap text-ink-faint">
                {b.txCount} txs · {formatBytes(b.sizeBytes)}
              </span>
              <span className="ml-auto text-xs whitespace-nowrap text-ink-faint">
                {timeAgo(b.timestamp, now)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
