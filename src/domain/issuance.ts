import {
  BLOSSOM_HEIGHT,
  NU7_HEIGHT,
  REISSUANCE_START_HEIGHT,
  estimateSecondsBetween,
  halvingHeight,
  nextHalvingHeight,
  nextSubsidyChangeHeight,
  scheduledSubsidyZat,
  subsidyTail,
} from "./halving";
import { DAY_SECONDS } from "./time";

/**
 * Issued supply: every ZEC the issuance schedule has paid out through a height.
 *
 * The schedule is consensus, so this is arithmetic, not an estimate: the six value pools plus the
 * NSM balance equal it to the zatoshi (checked against the node at 3,555,246). What is estimated
 * is only when a future height arrives, which `estimateSecondsBetween` answers for the whole site.
 *
 * The scheduled part only. From `REISSUANCE_START_HEIGHT` each block also reissues a share of the
 * ZEC removed from circulation (ZIP 237), which depends on removals nobody can know in advance.
 */

/** `SlowStartInterval`: the first 20,000 blocks ramped the subsidy up (§7.8). */
const SLOW_START_INTERVAL = 20_000;

/** `SlowStartRate = MaxBlockSubsidy / SlowStartInterval`, in zatoshi: 62,500. */
const SLOW_START_RATE = 1_250_000_000 / SLOW_START_INTERVAL;

/** Sum of the integers `from..to` inclusive, 0 when the range is empty. */
const sumRange = (from: number, to: number) =>
  to < from ? 0 : ((from + to) * (to - from + 1)) / 2;

/** The next height after `height` where the scheduled per-block subsidy may change. */
function nextSegmentStart(height: number): number {
  return Math.min(
    nextSubsidyChangeHeight(height),
    height < BLOSSOM_HEIGHT ? BLOSSOM_HEIGHT : Infinity,
  );
}

/**
 * Zatoshi the schedule has issued in blocks `0..height` inclusive.
 *
 * Closed form per stretch of constant subsidy: the slow start pays `62,500 × h` below block
 * 10,000 and `62,500 × (h + 1)` from it (so block 0 pays nothing), then each stretch between
 * Blossom, NU7 and the halvings pays one subsidy per block. Ends just under 21,000,000 ZEC: every
 * halving rounds down to the zatoshi, so the cap is never reached.
 */
export function scheduledIssuanceThroughZat(height: number): number {
  if (!Number.isInteger(height) || height < 0) throw new RangeError(`height ${height}`);
  const half = SLOW_START_INTERVAL / 2;
  let total = SLOW_START_RATE * sumRange(0, Math.min(height, half - 1));
  if (height < half) return total;
  total += SLOW_START_RATE * sumRange(half + 1, Math.min(height, SLOW_START_INTERVAL - 1) + 1);
  for (let from = SLOW_START_INTERVAL; from <= height;) {
    const subsidy = scheduledSubsidyZat(from);
    if (subsidy === 0) break;
    const end = Math.min(nextSegmentStart(from), height + 1);
    total += subsidy * (end - from);
    from = end;
  }
  return total;
}

/** Everything the schedule will ever issue: through the last block that pays a zatoshi. */
export const SCHEDULED_ISSUANCE_TOTAL_ZAT = scheduledIssuanceThroughZat(
  subsidyTail(halvingHeight(3)).zeroHeight - 1,
);

/** One point on the issuance curve: a block, when it was (or is estimated to be) mined, and the total. */
export interface IssuancePoint {
  /** Unix seconds. Observed for a past close; an estimate for a projected point. */
  at: number;
  height: number;
  issuedZat: number;
}

/** A scheduled change ahead of the tip, marked on the chart. */
export interface IssuanceEvent {
  kind: "halving" | "reissuance";
  /** The halving's number (1 is Canopy's); absent for reissuance. */
  index?: number;
  height: number;
  /** Estimated. */
  at: number;
}

/** The issuance curve: what has been issued, and the schedule from the tip on. */
export interface IssuanceOutlook {
  /** Daily closes, oldest first, each at the block the day closed on. */
  observed: IssuancePoint[];
  /**
   * The schedule ahead, oldest first: the tip at `now`, then each height where the per-block
   * subsidy or the block time changes. Issuance is linear in time between two of them.
   */
  projected: IssuancePoint[];
  /** Future halvings and the start of reissuance, within the projection. */
  events: IssuanceEvent[];
}

/** A day's closing block, as the daily supply series carries it. */
export interface DayClose {
  /** Unix seconds at the start of the UTC day. */
  timestamp: number;
  /** The day's highest block. */
  height: number;
}

/** Halvings the projection runs through, counted from Canopy's: the sixth, around 2040. */
export const PROJECTED_THROUGH_HALVING = 6;

/**
 * Closes kept for drawing. A thousand-unit chart cannot show a day of a ten-year curve, and every
 * close kept is one the series published: closes are picked evenly, never averaged.
 */
export const OBSERVED_POINTS = 600;

/** Every Nth item, keeping the first and the last. */
function pickEvenly<T>(items: readonly T[], max: number): T[] {
  if (items.length <= max) return [...items];
  const step = (items.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => items[Math.round(i * step)]!);
}

/**
 * The observed curve from daily closes, and the schedule projected from the tip.
 *
 * A close is drawn at the last second of its day (or `now`, for the day still running), because
 * the block it was read at closed the day. Future dates use `estimateSecondsBetween` from the tip
 * at `now`, the same estimate `/halving` counts down with.
 */
export function issuanceOutlook(
  closes: readonly DayClose[],
  tip: { height: number; observedIntervalSeconds: number },
  now: number,
  throughHalving = PROJECTED_THROUGH_HALVING,
): IssuanceOutlook {
  const observed = pickEvenly(
    [...closes].filter((c) => c.height <= tip.height).sort((a, b) => a.height - b.height),
    OBSERVED_POINTS,
  ).map((c) => ({
    at: Math.min(c.timestamp + DAY_SECONDS - 1, now),
    height: c.height,
    issuedZat: scheduledIssuanceThroughZat(c.height),
  }));

  const end = halvingHeight(throughHalving);
  const at = (height: number) =>
    now + estimateSecondsBetween(tip.height, height, tip.observedIntervalSeconds);
  const point = (height: number) => ({
    at: at(height),
    height,
    issuedZat: scheduledIssuanceThroughZat(height),
  });

  // Every height where the subsidy or the block time changes, so the straight line between two
  // breakpoints is the schedule itself, not an approximation of it.
  const breaks = new Set<number>();
  for (let h = tip.height; h < end; h = nextHalvingHeight(h)) breaks.add(nextHalvingHeight(h));
  if (NU7_HEIGHT > tip.height) breaks.add(NU7_HEIGHT);
  if (REISSUANCE_START_HEIGHT > tip.height && REISSUANCE_START_HEIGHT < end) {
    breaks.add(REISSUANCE_START_HEIGHT);
  }
  const projected = [tip.height, ...[...breaks].filter((h) => h <= end).sort((a, b) => a - b)].map(
    point,
  );

  const events: IssuanceEvent[] = [];
  for (let i = 1; i <= throughHalving; i += 1) {
    const height = halvingHeight(i);
    if (height > tip.height) events.push({ kind: "halving", index: i, height, at: at(height) });
  }
  if (REISSUANCE_START_HEIGHT > tip.height && REISSUANCE_START_HEIGHT < end) {
    events.push({
      kind: "reissuance",
      height: REISSUANCE_START_HEIGHT,
      at: at(REISSUANCE_START_HEIGHT),
    });
  }
  events.sort((a, b) => a.height - b.height);

  return { observed, projected, events };
}

/** The curve at one instant: the newest observed close, or the schedule interpolated by time. */
export interface IssuanceReading {
  projected: boolean;
  /** The close's own time when observed; the instant asked for when projected. */
  at: number;
  /** Exact when observed; when projected, the block estimated to be the tip at `at`. */
  height: number;
  issuedZat: number;
}

/**
 * The curve read at `t`. Before the projection starts it is the newest close at or before `t`
 * (null before the first); after, the height the schedule estimates for `t`, floored to a whole
 * block, and exactly what the schedule has issued by it.
 */
export function issuanceAt(outlook: IssuanceOutlook, t: number): IssuanceReading | null {
  const start = outlook.projected[0];
  if (start === undefined || t <= start.at) {
    const close = outlook.observed.findLast((p) => p.at <= t);
    return close ? { projected: false, ...close } : null;
  }
  const k = outlook.projected.findIndex((p) => p.at >= t);
  if (k < 0) return null;
  const a = outlook.projected[k - 1]!;
  const b = outlook.projected[k]!;
  const height = Math.floor(a.height + ((t - a.at) / (b.at - a.at)) * (b.height - a.height));
  return { projected: true, at: t, height, issuedZat: scheduledIssuanceThroughZat(height) };
}
