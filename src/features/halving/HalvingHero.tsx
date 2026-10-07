import type { HalvingEvent, HalvingSchedule } from "@/domain";
import {
  BLOCK_TARGET_SECONDS,
  epochBounds,
  epochProgress,
  estimateHalvingSeconds,
  utcDayFromSeconds,
} from "@/domain";
import { formatCount, formatDateLong, formatDurationCoarse, formatZecAmount } from "@/lib/format";
import { HalvingCountdown } from "./HalvingCountdown";
import { HalvingScene } from "./HalvingScene";
import { Height } from "./Height";

export interface HalvingHeroProps {
  schedule: HalvingSchedule;
  /** The halving being counted to. */
  next: HalvingEvent;
  /** Wall clock at render, so the estimate is anchored once and the countdown agrees with it. */
  now: number;
  /** Seconds per block the date is extrapolated at: the observed average, or the target. */
  interval: number;
  /** Whether `interval` was measured, rather than the consensus target standing in for it. */
  measured: boolean;
}

/** How many ticks the epoch meter is drawn with. */
const METER_TICKS = 96;

/**
 * One hero fact: label, dotted leader, value, and a word only when the value is an estimate.
 *
 * The leader is a repeating radial gradient rather than a dotted border, because a 1px
 * dotted border at this opacity renders as a hairline on most engines and stops reading as
 * a leader at all.
 */
function HeroFact({
  label,
  value,
  secondary,
  estimate = false,
}: {
  label: string;
  value: string;
  secondary?: string;
  estimate?: boolean;
}) {
  return (
    <div className="flex items-baseline">
      <dt className="microlabel whitespace-nowrap text-ink-faint">{label}</dt>
      <span className="dot-leader mx-3 flex-1 self-center" aria-hidden="true" />
      <dd className="text-right">
        <span
          className={`font-mono whitespace-nowrap tabular-nums ${estimate ? "text-ink-dim" : "text-ink-bright"}`}
        >
          {value}
        </span>
        {/* The spelled-out date wraps on a phone and squeezes the leaders out; the ISO date
            beside it is already unambiguous, so the phone shows only that. */}
        {secondary ? (
          <span className="hidden text-xs font-normal text-ink-faint sm:block">{secondary}</span>
        ) : null}
      </dd>
      {/* A real non-breaking space, not only the margin: a whitespace-only text node between
          flex items is discarded, so `{" "}` would render nothing. Not `.microlabel`: its
          tracking makes the word wider than the column at 375px. */}
      <span className="ml-3 w-16 shrink-0 text-right text-[10px] tracking-[0.08em] text-ink-faint uppercase sm:w-20 sm:text-[11px] sm:tracking-[0.12em]">
        {estimate ? " estimate" : ""}
      </span>
    </div>
  );
}

/**
 * The countdown panel. It has to survive being screenshotted alone, so it names the block it is
 * counting to and the block it was read at; a bare clock says nothing checkable.
 */
export function HalvingHero({ schedule, next, now, interval, measured }: HalvingHeroProps) {
  const blocksRemaining = Math.max(0, next.height - schedule.height);
  const secondsRemaining = estimateHalvingSeconds(
    blocksRemaining,
    schedule.observedIntervalSeconds,
  );
  const targetSeconds = now + secondsRemaining;
  const progress = epochProgress(schedule.height);
  const { from: epochFrom } = epochBounds(schedule.height);

  return (
    <section
      className="panel relative overflow-hidden text-center"
      aria-label={`Countdown to the Zcash halving at block ${next.height}`}
    >
      <HalvingScene />
      <div className="halving-bed pointer-events-none absolute inset-0" aria-hidden="true" />

      {/* The site's terminal grammar, as in nav links (`> blocks`) and search (`zcash>`). */}
      <div className="relative flex items-center justify-between border-b border-edge-faint px-4 py-2.5 sm:px-6">
        <span className="font-mono text-xs text-ink-dim">
          <span className="text-green">zcash&gt;</span> halving --next
        </span>
        <span className="microlabel flex items-center gap-2 text-ink-faint">
          <span className="h-1.5 w-1.5 rounded-full bg-green" aria-hidden="true" />
          counting
        </span>
      </div>

      <div className="relative px-4 py-8 sm:px-8 sm:py-10">
        <div className="microlabel text-ink-faint">
          NEXT HALVING · BLOCK {formatCount(next.height)}
        </div>
        <div className="mt-4">
          <HalvingCountdown
            targetSeconds={targetSeconds}
            fallback={formatDurationCoarse(secondsRemaining)}
          />
        </div>

        {/* What the clock counts TO. Without it the hero is a timer to an unnamed event,
            and this panel has to survive being screenshotted on its own. */}
        <div className="mt-5 flex flex-wrap items-baseline justify-center gap-x-3 gap-y-1">
          <span className="microlabel text-ink-faint">AT THAT BLOCK</span>
          <span className="font-mono text-xl font-bold text-ink-dim tabular-nums sm:text-2xl">
            {formatZecAmount(next.before.totalZat)} <span className="text-green-dim">→</span>{" "}
            <span className="font-extrabold text-ink-bright">
              {formatZecAmount(next.after.totalZat)}
            </span>
          </span>
          <span className="microlabel text-ink-faint">ZEC PER BLOCK</span>
        </div>

        {/*
         * The meter is made of blocks, because what it measures is blocks: the fraction is
         * the count of lit ticks, so no computed width is needed.
         */}
        <div className="mt-7">
          <div
            className="flex h-3.5 gap-px"
            role="img"
            aria-label={`${(progress * 100).toFixed(1)} percent through the current halving period`}
          >
            {Array.from({ length: METER_TICKS }, (_, i) => (
              <span
                key={i}
                className={
                  i < Math.round(progress * METER_TICKS)
                    ? "flex-1 bg-green-dim"
                    : "flex-1 bg-green-faint opacity-50"
                }
              />
            ))}
          </div>
          <div className="mt-2 flex justify-between font-mono text-[11px] text-ink-faint">
            <Height value={epochFrom} />
            <span className="text-ink-dim">{(progress * 100).toFixed(1)}% of this epoch</span>
            <Height value={next.height} />
          </div>
        </div>

        {/*
         * Only the row that departs from the default carries a word. "Blocks to go" is exact
         * only as of the height beside it, so stamping EXACT would overclaim; "read at
         * block" is the anchor and cannot be inexact.
         */}
        <dl className="mt-6 flex flex-col gap-2 border-t border-edge-faint pt-4 text-left text-sm">
          <HeroFact label="BLOCKS TO GO" value={formatCount(blocksRemaining)} />
          <HeroFact label="READ AT BLOCK" value={formatCount(schedule.height)} />
          {/* Both date forms: the ISO one is unambiguous and sorts, the spelled-out one
              is what a reader pictures. On a moment two years out, "2028-11-27" alone is
              a string to parse rather than a date. */}
          <HeroFact
            label="ESTIMATED"
            value={`~${utcDayFromSeconds(targetSeconds)}`}
            estimate
            secondary={formatDateLong(targetSeconds)}
          />
        </dl>

        <p className="mx-auto mt-5 max-w-2xl text-xs leading-relaxed text-ink-faint">
          {measured
            ? `Both heights are consensus, read together at block ${formatCount(schedule.height)}. The date extrapolates the ${interval.toFixed(2)}-second average block time measured over the last 30 days, not the ${BLOCK_TARGET_SECONDS}-second target — over this distance the two differ by several days.`
            : `Both heights are consensus, read together at block ${formatCount(schedule.height)}. The date comes from the ${BLOCK_TARGET_SECONDS}-second consensus target: the observed block time could not be measured just now, so this is the schedule's intent rather than the chain's recent pace.`}
        </p>
      </div>
    </section>
  );
}
