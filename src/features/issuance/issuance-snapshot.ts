import type { DayClose, HalvingSchedule, IssuanceOutlook, SupplyBreakdown } from "@/domain";
import {
  allPoolsSupply,
  issuanceOutlook,
  issuancePerDayZat,
  scheduledSubsidyZat,
  targetSpacingAt,
} from "@/domain";

/** Everything the issuance panel states, read once. */
export interface IssuanceSnapshot {
  outlook: IssuanceOutlook;
  /** Pools plus the NSM at the tip, as `/shielded` reads it. Null when the supply was unread. */
  issued: { zat: number; height: number } | null;
  /** The 21M cap less `issued`. Null with it. */
  remainingZat: number | null;
  /** ZEC a day at today's subsidy and block rate, as `/halving` estimates it. */
  perDayZat: number;
  /** Whether the block rate behind `perDayZat` was measured, rather than the target. */
  measured: boolean;
  /** Where the projection starts. */
  now: number;
}

/**
 * The issuance panel's figures. The daily rate is `/halving`'s: today's scheduled subsidy at the
 * observed block interval, or the target where none was measured. Mainnet only, like `/halving`.
 */
export function issuanceSnapshot(
  closes: readonly DayClose[],
  schedule: HalvingSchedule,
  supply: SupplyBreakdown | null,
  now: number,
): IssuanceSnapshot {
  const measured = schedule.observedIntervalSeconds > 0;
  const interval = measured ? schedule.observedIntervalSeconds : targetSpacingAt(schedule.height);
  const all = supply ? allPoolsSupply(supply, "mainnet") : null;
  return {
    outlook: issuanceOutlook(closes, schedule, now),
    issued: all && all.issuedZat !== null ? { zat: all.issuedZat, height: all.height } : null,
    remainingZat: all?.unminedZat ?? null,
    perDayZat: issuancePerDayZat(scheduledSubsidyZat(schedule.height), interval),
    measured,
    now,
  };
}
