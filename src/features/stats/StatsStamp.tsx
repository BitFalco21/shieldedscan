import { formatCount, formatUtc } from "@/lib/format";

export interface StatsStampProps {
  height: number;
  asOf: number;
}

/**
 * What the figures above were read at. This page is built to be screenshotted, and a number
 * stamped with its block and instant stays true where a bare "now" decays.
 *
 * The height is the chain's clock and the timestamp is the price's: two clocks, named
 * separately, because the price comes from a venue poll and the pools from the node.
 */
export function StatsStamp({ height, asOf }: StatsStampProps) {
  return (
    <p className="microlabel flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="stats-live-dot" aria-hidden="true" />
      <span>mainnet</span>
      <span aria-hidden="true" className="stats-stamp-rule" />
      <span>read at block {formatCount(height)}</span>
      <span aria-hidden="true" className="stats-stamp-rule" />
      <span>{formatUtc(asOf)}</span>
    </p>
  );
}
