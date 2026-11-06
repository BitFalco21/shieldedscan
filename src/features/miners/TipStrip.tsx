import {
  MINER_SUBSIDY_BEFORE_NU7_ZAT,
  minerFeeSharePct,
  NU7_HEIGHT,
  targetSpacingSeconds,
  type MiningTerms,
} from "@/domain";
import { StatCard } from "@/components/StatCard";
import { StatGrid } from "@/components/StatGrid";
import { formatCount, formatUsdExact, formatZec, formatZecAmount } from "@/lib/format";
import { formatDifficulty, formatInterval, formatSolRate } from "./format";

export interface TipStripProps {
  terms: MiningTerms;
}

/**
 * The tip's terms, not windowed: what a block pays its miner now (the node's own subsidy split,
 * at today's price), the observed block time, the node's solution rate and the difficulty. The
 * fee share and the pre-NU7 subsidy come from the consensus rules, never from a constant here.
 */
export function TipStrip({ terms }: TipStripProps) {
  const feeShare = minerFeeSharePct(terms.height);
  return (
    <section aria-labelledby="tip-heading" className="mt-6">
      <h2 id="tip-heading" className="microlabel text-ink-faint">
        AT THE TIP · BLOCK {formatCount(terms.height)}
      </h2>
      <StatGrid columns={4} className="mt-2">
        <StatCard
          label="MINER REWARD / BLOCK"
          value={
            <>
              {formatZec(terms.minerSubsidyZat)}
              {terms.priceUsd === null ? null : (
                <span className="text-base text-ink-dim">
                  {" "}
                  · {formatUsdExact((terms.minerSubsidyZat / 1e8) * terms.priceUsd)}
                </span>
              )}
            </>
          }
          sub={
            terms.height >= NU7_HEIGHT
              ? `+ ${feeShare}% of fees · was ${formatZecAmount(MINER_SUBSIDY_BEFORE_NU7_ZAT)} before NU7`
              : `+ ${feeShare}% of fees`
          }
        />
        <StatCard
          label="BLOCK TIME"
          value={formatInterval(terms.blockIntervalSeconds)}
          sub={`observed · ${targetSpacingSeconds("mainnet", terms.height)}s target`}
        />
        <StatCard
          label="SOLUTION RATE"
          value={formatSolRate(terms.networkSolps.value)}
          sub={terms.networkSolps.basis === "node" ? "from the node" : "estimated"}
        />
        <StatCard label="DIFFICULTY" value={formatDifficulty(terms.difficulty)} sub="at the tip" />
      </StatGrid>
    </section>
  );
}
