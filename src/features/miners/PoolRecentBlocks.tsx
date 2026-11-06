import type { MiningPoolBlock } from "@/domain";
import { DataTable } from "@/components/DataTable";
import Link from "@/components/Link";
import { Unmeasured } from "@/components/Unmeasured";
import { formatCount, formatZec, timeAgo } from "@/lib/format";

export interface PoolRecentBlocksProps {
  blocks: MiningPoolBlock[];
  nowSec: number;
}

/** A pool's newest blocks, each linked to its page, with what it paid the pool. */
export function PoolRecentBlocks({ blocks, nowSec }: PoolRecentBlocksProps) {
  if (blocks.length === 0) {
    return <p className="text-sm text-ink-faint">No recent blocks.</p>;
  }
  return (
    <DataTable
      caption="The pool's newest blocks"
      columns={[{ label: "BLOCK" }, { label: "TIME" }, { label: "REWARD", align: "right" }]}
    >
      {blocks.map((b) => (
        <tr key={b.height} className="row-hover hairline-b last:border-0">
          <td>
            <Link href={`/block/${b.height}`} className="text-green hover:underline">
              #{formatCount(b.height)}
            </Link>
          </td>
          <td className="text-ink-dim">{timeAgo(b.timestamp, nowSec)}</td>
          <td className="text-right tabular-nums">
            {b.rewardZat === null ? <Unmeasured /> : formatZec(b.rewardZat)}
          </td>
        </tr>
      ))}
    </DataTable>
  );
}
