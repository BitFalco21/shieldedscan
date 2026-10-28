import type { HalvingSchedule, SubsidySplit } from "@/domain";

/**
 * The halving schedule, for the fixture build.
 *
 * Real consensus figures from the node's `getblocksubsidy` (Zakura 1.7.0), kept exact: the
 * page's claim is that the miner's share does not halve at the next event, and a tidy
 * 50%-everywhere split would render a sentence its own data contradicts. Read before NU7, so
 * the build shows the NU7 panel and the third halving at its post-NU7 height.
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
    // Before NU7, so the countdown crosses it and the "before that" panel renders.
    height: 3_533_753,
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
        // The next one, where NU7 moves it. Streams and lockbox both expire, so the miner takes
        // all of it — which is why the miner's fall is 37.5% where the total's is 50%. "Before"
        // is already NU7's third of today's subsidy.
        height: 6_132_390,
        at: null,
        before: split(52_083_333, 41_666_668, 4_166_666, 6_249_999),
        after: split(26_041_666, 26_041_666),
      },
    ],
    upcoming: [
      { height: 11_172_390, totalZat: 13_020_833 },
      { height: 16_212_390, totalZat: 6_510_416 },
      { height: 21_252_390, totalZat: 3_255_208 },
      { height: 26_292_390, totalZat: 1_627_604 },
    ],
    asOf: Math.floor(Date.now() / 1000),
  };
}
