import type { ActivityPoint } from "@/domain";
import { TIP_TIME } from "./ids";

const DAY = 86_400;

/** 14 days of activity, shielded share drifting up from ~52% to ~63%. */
export const activitySeries: ActivityPoint[] = Array.from({ length: 14 }, (_, i) => {
  const transparentTxs = 3_400 - i * 60 + (i % 3) * 90;
  const mixedTxs = 900 + i * 25 + (i % 4) * 40;
  const shieldedTxs = 3_900 + i * 130 + (i % 5) * 70;
  return {
    timestamp: TIP_TIME - (13 - i) * DAY,
    transparentTxs,
    mixedTxs,
    shieldedTxs,
    medianFeeZat: 10_000 + (i % 3) * 1_000,
    netPoolFlowZat: (i % 4 === 3 ? -1 : 1) * (120_000_000_000 + i * 7_000_000_000),
  };
});
