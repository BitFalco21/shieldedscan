import { NU7_HEIGHT, minerFeeShareZat, utcDayOf, type NsmDay, type NsmOverview } from "@/domain";
import { DAY_SECONDS } from "@/domain/time";
import { TIP_TIME } from "./ids";

/**
 * The NSM for the fixture build. The fixture chain sits below NU7, so this one figure is set on
 * its own clock: activation ten days before the fixture's tip, at NU7's real height, so the 7D
 * window falls wholly after it and the 30D window opens before it, as on the live chain in NU7's
 * first weeks. Each day's NSM share comes from the consensus split of a per-block fee, and the
 * balance is every day's share added up: nothing has been reissued yet.
 */

const BLOCKS_PER_DAY = 3_456;
const CLOSE_USD = 560;
const DAYS = 10;
/** Activation at 02:34 UTC, so its day holds ~89% of a day's blocks; today is ~73% through. */
const ACTIVATION_DAY_SHARE = 0.893;
const TODAY_SHARE = 0.735;

export function getNsmOverview(): NsmOverview {
  const todayStart = Math.floor(TIP_TIME / DAY_SECONDS) * DAY_SECONDS;
  const days: NsmDay[] = Array.from({ length: DAYS }, (_, k) => {
    const i = DAYS - 1 - k;
    const share = k === 0 ? ACTIVATION_DAY_SHARE : i === 0 ? TODAY_SHARE : 1;
    const blocks = Math.round(BLOCKS_PER_DAY * share);
    // Fees drift day to day around 0.001 ZEC a block.
    const feePerBlock = Math.round(100_000 * (1 + 0.25 * Math.sin(k * 1.3)));
    const nsmPerBlock = feePerBlock - minerFeeShareZat("mainnet", NU7_HEIGHT, feePerBlock);
    return {
      day: utcDayOf(todayStart - i * DAY_SECONDS),
      blocks,
      feeZat: blocks * feePerBlock,
      nsmZat: blocks * nsmPerBlock,
      closeUsd: i === 0 ? null : CLOSE_USD,
      partial: i === 0,
    };
  });
  const blocks = days.reduce((s, d) => s + d.blocks, 0);
  return {
    activationHeight: NU7_HEIGHT,
    activationDay: days[0]!.day,
    balance: {
      height: NU7_HEIGHT + blocks - 1,
      zat: days.reduce((s, d) => s + d.nsmZat!, 0),
    },
    days,
  };
}
