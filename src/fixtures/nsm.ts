import { NU7_HEIGHT, minerFeeShareZat, utcDayOf, type NsmDay, type NsmOverview } from "@/domain";
import { DAY_SECONDS } from "@/domain/time";
import { chainInfo } from "./chain";
import { TIP_TIME } from "./ids";

/**
 * The NSM for the fixture build. The fixture chain sits below NU7, so this one figure is set on
 * its own clock: activation two days before the fixture's tip, at NU7's real height, so every
 * window opens before it and the chart is a few days long, as on the live chain in NU7's first
 * days. Each day's NSM share comes from the consensus split of a per-block fee. The
 * balance is the real case: what ZIP 234 carried in at NU7 (the subsidy miners never claimed,
 * the open dataset's underclaim) plus every day's share, nothing reissued yet. Closes sit near
 * the fixture's live price, so a day's USD and the balance's agree.
 */

const BLOCKS_PER_DAY = 3_456;
/** The open dataset's underclaim at NU7: what the NSM opened with. */
const CARRIED_IN_ZAT = 36_858_445_520;
const DAYS = 3;
/** Activation at 02:34 UTC, so its day holds ~89% of a day's blocks; today is ~73% through. */
const ACTIVATION_DAY_SHARE = 0.893;
const TODAY_SHARE = 0.735;

export function getNsmOverview(): NsmOverview {
  const todayStart = Math.floor(TIP_TIME / DAY_SECONDS) * DAY_SECONDS;
  const days: NsmDay[] = Array.from({ length: DAYS }, (_, k) => {
    const i = DAYS - 1 - k;
    const share = k === 0 ? ACTIVATION_DAY_SHARE : i === 0 ? TODAY_SHARE : 1;
    const blocks = Math.round(BLOCKS_PER_DAY * share);
    // Fees drift day to day around 0.0005 ZEC a block, the live chain's level.
    const feePerBlock = Math.round(50_000 * (1 + 0.25 * Math.sin(k * 1.3)));
    const nsmPerBlock = feePerBlock - minerFeeShareZat("mainnet", NU7_HEIGHT, feePerBlock);
    return {
      day: utcDayOf(todayStart - i * DAY_SECONDS),
      blocks,
      feeZat: blocks * feePerBlock,
      nsmZat: blocks * nsmPerBlock,
      closeUsd:
        i === 0 ? null : Math.round(chainInfo.priceUsd! * (1 + 0.03 * Math.sin(k)) * 100) / 100,
      partial: i === 0,
    };
  });
  const blocks = days.reduce((s, d) => s + d.blocks, 0);
  return {
    activationHeight: NU7_HEIGHT,
    activationDay: days[0]!.day,
    balance: {
      height: NU7_HEIGHT + blocks - 1,
      zat: CARRIED_IN_ZAT + days.reduce((s, d) => s + d.nsmZat!, 0),
      carriedInZat: CARRIED_IN_ZAT,
    },
    days,
  };
}
