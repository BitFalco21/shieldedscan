import { LiveIndicator } from "@/components/LiveIndicator";
import { formatCount } from "@/lib/format";
import type { LiveSupplyStatus } from "./useLiveSupply";

export interface SupplyLiveStatusProps {
  height: number;
  status: LiveSupplyStatus;
}

/**
 * The block every figure on the view was read at, and whether it is still following the chain.
 * "Live" only once the browser's own poll has been accepted; a stopped feed says so in words.
 */
export function SupplyLiveStatus({ height, status }: SupplyLiveStatusProps) {
  const block = `block ${formatCount(height)}`;
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-dim">
      {status === "live" ? (
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-green" />
          live · {block}
        </span>
      ) : (
        <span>{`read at ${block}`}</span>
      )}
      {status === "unavailable" ? <LiveIndicator status="unavailable" /> : null}
    </p>
  );
}
