import type { Pool } from "pg";
import type { OrchardDrain } from "@/domain";
import "./pg-types";

/**
 * Orchard emptying into Ironwood, for the private Ironwood route and `/v1/analytics/ironwood`.
 *
 * Both halves come from tables the rollup pass already keeps: each UTC day's migrations from
 * `chain_day_pool_migration` (the migration rule `/v1/analytics/migrations` serves) and Orchard's
 * balance at each day's last block from `chain_day_supply_close`. The denominator is one
 * primary-key read: Orchard at the block before activation. Complete days only: today's close is
 * not made yet, and a partial day's migrations would read as a slowdown.
 */

/** `$1`: the activation height. */
export const ORCHARD_DRAIN_BASE_SQL = `
  SELECT orchard_pool_zat::text AS base FROM block WHERE height = $1::int - 1`;

/** `$1`: the activation height. One row per complete UTC day from the activation block's. */
export const ORCHARD_DRAIN_DAYS_SQL = `
  WITH act AS (
    SELECT (to_timestamp(timestamp) AT TIME ZONE 'UTC')::date AS day FROM block WHERE height = $1::int
  ),
  mig AS (
    SELECT m.day,
           COALESCE(sum(m.zat) FILTER (WHERE m.source = 'orchard'), 0) AS orchard,
           COALESCE(sum(m.zat) FILTER (WHERE m.source = 'multi'), 0)   AS multi
      FROM chain_day_pool_migration m, act
     WHERE m.destination = 'ironwood' AND m.day >= act.day
     GROUP BY m.day
  )
  SELECT EXTRACT(EPOCH FROM c.day)::bigint AS ts,
         c.top_height AS height,
         c.orchard_pool_zat::text AS orchard,
         COALESCE(mig.orchard, 0)::text AS migrated,
         COALESCE(mig.multi, 0)::text AS multi
    FROM chain_day_supply_close c
    JOIN act ON c.day >= act.day
    LEFT JOIN mig ON mig.day = c.day
   WHERE c.day < (now() AT TIME ZONE 'UTC')::date
   ORDER BY c.day`;

interface DayRow {
  ts: string;
  height: number;
  orchard: string | null;
  migrated: string;
  multi: string;
}

export async function loadOrchardDrain(
  pool: Pick<Pool, "query">,
  activationHeight: number,
): Promise<OrchardDrain> {
  const [base, days] = await Promise.all([
    pool.query<{ base: string | null }>(ORCHARD_DRAIN_BASE_SQL, [activationHeight]),
    pool.query<DayRow>(ORCHARD_DRAIN_DAYS_SQL, [activationHeight]),
  ]);
  const b = base.rows[0]?.base ?? null;
  return {
    activationHeight,
    baseHeight: activationHeight - 1,
    baseOrchardZat: b === null ? null : Number(b),
    days: days.rows.map((r) => ({
      timestamp: Number(r.ts),
      closeHeight: Number(r.height),
      orchardZat: r.orchard === null ? null : Number(r.orchard),
      migratedZat: Number(r.migrated),
      multiSourceZat: Number(r.multi),
    })),
  };
}
