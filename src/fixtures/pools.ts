import type {
  PoolMigrationDayPoint,
  PoolUsageDayPoint,
  ShieldedPool,
  ShieldedSupplyPoint,
} from "@/domain";
import { TIP_HEIGHT, TIP_TIME } from "./ids";

export const pools: ShieldedPool[] = [
  { pool: "orchard", balanceZat: 194_000_000_000_000 },
  // Ironwood is active on mainnet; without it the fixtures cannot express the four-pool page.
  { pool: "ironwood", balanceZat: 53_900_000_000_000 },
  { pool: "sapling", balanceZat: 61_200_000_000_000 },
  { pool: "sprout", balanceZat: 1_190_000_000_000 },
];

/** 86,400 / 75, the block target. */
const BLOCKS_PER_DAY = 1_152;

/** Long enough that 30d, 60d, 180d and 1y each drop something the next one keeps. */
const SUPPLY_DAYS = 400;

/**
 * The series ends at the pool total above, exactly, and starts at a sixteenth of it.
 *
 * Ending there matches the live page, where the newest point and the headline come from one
 * reading; a chart ending elsewhere would contradict its own headline. Starting low gives
 * the fixture the dynamic range of the real series (tens of ZEC to millions), so a clipped
 * axis is exercised.
 */
const SUPPLY_END_ZAT = pools.reduce((sum, p) => sum + p.balanceZat, 0);
const SUPPLY_START_ZAT = Math.round(SUPPLY_END_ZAT / 16);

/** ~13 months of total shielded supply, one point per day, rising with a little texture. */
export const supplySeries: ShieldedSupplyPoint[] = Array.from({ length: SUPPLY_DAYS }, (_, i) => {
  const age = SUPPLY_DAYS - 1 - i;
  // 399 is a multiple of 7, so the wobble is zero at both ends: the first point is exactly
  // the start and the last is exactly the pool total, rather than near them.
  const wobble = (i % 7) * 250_000_000_000;
  return {
    // One point per day, matching the live series' grain, so the chart's time axis has
    // something real to label.
    timestamp: TIP_TIME - age * 86_400,
    height: TIP_HEIGHT - age * BLOCKS_PER_DAY,
    totalZat:
      Math.round(SUPPLY_START_ZAT + ((SUPPLY_END_ZAT - SUPPLY_START_ZAT) * i) / (SUPPLY_DAYS - 1)) +
      wobble,
  };
});

/** Long enough that every range preset drops something — the supply series' own rule. */
const POOL_SERIES_DAYS = 400;

/**
 * The fixture Ironwood "activation": the pool appears only in the last quarter of the series,
 * so the born-mid-series rendering (no line, band or readout row before it) is exercised.
 */
const IRONWOOD_FIRST_INDEX = 300;

/**
 * Transactions touching each pool per day. Not a partition of any total: one transaction can
 * carry two pools' bundles, so the counts sum past the chain's volume. A fixture whose counts
 * partitioned would let a stacked rendering pass while fabricating a total.
 */
export const poolUsageSeries: PoolUsageDayPoint[] = Array.from(
  { length: POOL_SERIES_DAYS },
  (_, i) => {
    const age = POOL_SERIES_DAYS - 1 - i;
    return {
      timestamp: TIP_TIME - age * 86_400,
      // Sprout fades from a real presence to near-zero; Sapling holds; Orchard dominates.
      sproutTxs: Math.max(
        0,
        Math.round(40 - (40 * i) / (POOL_SERIES_DAYS - 1)) - (i % 5 === 0 ? 1 : 0),
      ),
      saplingTxs: 120 + (i % 7) * 4,
      orchardTxs: 700 + (i % 11) * 15,
      ironwoodTxs: i >= IRONWOOD_FIRST_INDEX ? 60 + (i % 3) * 8 : 0,
    };
  },
);

/**
 * ZEC migrating between pools per day, keyed by destination. Two destinations are active
 * (Sapling→Orchard early, the Orchard→Ironwood turnstile from Ironwood's fixture birthday),
 * and a few quiet days sit inside the range so the zero-filled day renders.
 */
export const poolMigrationSeries: PoolMigrationDayPoint[] = Array.from(
  { length: POOL_SERIES_DAYS },
  (_, i) => {
    const age = POOL_SERIES_DAYS - 1 - i;
    const quiet = i % 53 === 17;
    const ironwoodRamp =
      i >= IRONWOOD_FIRST_INDEX
        ? Math.round(
            ((i - IRONWOOD_FIRST_INDEX + 1) / (POOL_SERIES_DAYS - IRONWOOD_FIRST_INDEX)) *
              900_000_000_000,
          )
        : 0;
    return {
      timestamp: TIP_TIME - age * 86_400,
      toSproutZat: 0,
      toSaplingZat: 0,
      toOrchardZat: quiet ? 0 : 4_000_000_000 + (i % 9) * 700_000_000,
      toIronwoodZat: quiet ? 0 : ironwoodRamp,
    };
  },
);
