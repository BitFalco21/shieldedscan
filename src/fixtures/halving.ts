import type { HalvingSchedule, SubsidySplit } from "@/domain";

/**
 * The halving schedule, for the fixture build.
 *
 * Real consensus figures from the node's `getblocksubsidy`, kept exact: the page's claim is
 * that the miner's share does not halve at the next event, and a tidy 50%-everywhere split
 * would render a sentence its own data contradicts.
 *
 * The block interval is a measured ~75.35s, not the 75s target: the difference is days on
 * the estimate, and the page reports an observed figure.
 */
const split = (total: number, miner: number, streams = 0, lockbox = 0): SubsidySplit => ({
  totalZat: total,
  minerZat: miner,
  fundingStreamsZat: streams,
  lockboxZat: lockbox,
});

export function getHalvingSchedule(): HalvingSchedule {
  return {
    // Just short of the fixture chain's tip, so the countdown is a real distance.
    height: 3_445_362,
    observedIntervalSeconds: 75.35,
    events: [
      {
        // Blossom: the block target halved with the subsidy, so daily issuance did not move.
        // Exercises the "not a halving" row.
        kind: "block-time-change" as const,
        height: 653_600,
        at: 1_576_101_005, // 2019-12-11 21:50:05 UTC
        before: split(1_250_000_000, 1_000_000_000, 250_000_000),
        after: split(625_000_000, 500_000_000, 125_000_000),
      },
      {
        kind: "halving" as const,
        // Canopy. The Founders' Reward ended here and ZIP-214's streams began.
        height: 1_046_400,
        at: 1_605_702_856, // 2020-11-18 12:34:16 UTC
        before: split(625_000_000, 500_000_000, 125_000_000),
        after: split(312_500_000, 250_000_000, 62_500_000),
      },
      {
        kind: "halving" as const,
        // NU6. The lockbox begins here, taking 12% of the subsidy.
        height: 2_726_400,
        at: 1_732_359_779, // 2024-11-23 11:02:59 UTC
        before: split(312_500_000, 250_000_000, 62_500_000),
        after: split(156_250_000, 125_000_000, 12_500_000, 18_750_000),
      },
      {
        kind: "halving" as const,
        // The next one. Streams and lockbox both expire, so the miner takes all of it —
        // which is why the miner's fall is 37.5% where the total's is 50%.
        height: 4_406_400,
        at: null,
        before: split(156_250_000, 125_000_000, 12_500_000, 18_750_000),
        after: split(78_125_000, 78_125_000),
      },
    ],
    upcoming: [
      { height: 6_086_400, totalZat: 39_062_500 },
      { height: 7_766_400, totalZat: 19_531_250 },
      { height: 9_446_400, totalZat: 9_765_625 },
      { height: 11_126_400, totalZat: 4_882_812 },
    ],
    asOf: Math.floor(Date.now() / 1000),
  };
}
