import type { Stats } from "@/domain";
import { poolShareOfShieldedPct } from "@/domain";
import { POOL_INK } from "@/components/PoolBadge";
import { ShareBar } from "@/components/ShareBar";
import { Unmeasured } from "@/components/Unmeasured";
import { formatSharePct, formatZecWhole } from "@/lib/format";

export interface PoolStripProps {
  stats: Stats;
}

/**
 * Each shielded pool's balance and its share of everything shielded, under the shielded face.
 * The bar's ink is `PoolBadge`'s own ramp, imported rather than restated, so the bar and the
 * badge cannot drift.
 */
export function PoolStrip({ stats }: PoolStripProps) {
  const { pools, totalShieldedZat } = stats.shielded;
  return (
    <ul className="stats-pools">
      {pools.map((pool) => {
        const poolShare = poolShareOfShieldedPct(pool, totalShieldedZat);
        return (
          <li key={pool.pool} className="stats-pool">
            <span className="microlabel">{pool.pool}</span>
            <span className="text-ink-bright">{formatZecWhole(pool.balanceZat)}</span>
            <ShareBar pct={poolShare} className="h-1 w-full" fillClassName={POOL_INK[pool.pool]} />
            <span className="microlabel">
              {poolShare === null ? <Unmeasured /> : `${formatSharePct(poolShare)} of shielded`}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
