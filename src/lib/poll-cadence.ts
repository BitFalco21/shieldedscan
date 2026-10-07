/**
 * The one cadence rule for every live poller (`use-live-feed.ts`, `usePulseLive.ts`,
 * `useLiveStats.ts`). Each counts consecutive failures, derives "unavailable" from the count,
 * and backs off once unavailable: a 5xx is not CDN-cacheable, so every poll against an outage
 * is a billed origin invocation. One shared function keeps the back-off from being forgotten.
 */

/**
 * Three consecutive failures before saying so. One blip is not an outage, but a page that is
 * silently no longer current must not go unannounced.
 */
export const FAILURES_BEFORE_UNAVAILABLE = 3;

/**
 * The cadence once unavailable. Long enough that an outage costs the origin one probe a
 * minute per tab instead of six; short enough that recovery is noticed within a minute.
 */
export const UNAVAILABLE_INTERVAL_MS = 60_000;

/** The regular cadence, matched to the live endpoints' `s-maxage=5`: about every other poll reaches the origin. */
export const POLL_INTERVAL_MS = 10_000;

/**
 * The fast cadence while a block is known to be due: the payload's fresh tip sits above its own
 * coalesced list, so a block exists and has not shipped yet. Cheap, because the CDN answers most
 * chase polls.
 */
export const CHASE_INTERVAL_MS = 3_000;

/**
 * Chase at most this many polls in a row, then return to the regular cadence, so an API wedged
 * stale cannot turn every open tab into a three-second poller.
 */
export const MAX_CHASES = 8;

export interface PollCadenceInput {
  /** Consecutive failed polls so far; the status is derived from it, never stored beside it. */
  failures: number;
  /** The payload said a block exists that it has not shipped yet. */
  blockDue: boolean;
  /** Chase polls left in the budget; bounded so a wedged API cannot make every tab a 3 s poller. */
  chasesLeft: number;
  intervalMs: number;
  chaseMs: number;
  unavailableIntervalMs: number;
}

/**
 * How long to wait before the next poll, and whether that wait is a chase (which spends one
 * unit of the chase budget). An outage is never chased: the block the payload promised will
 * not arrive faster because we ask an unreachable API sooner.
 */
export function pollDelayMs(input: PollCadenceInput): { delay: number; chasing: boolean } {
  if (input.failures >= FAILURES_BEFORE_UNAVAILABLE) {
    return { delay: input.unavailableIntervalMs, chasing: false };
  }
  const chasing = input.blockDue && input.chasesLeft > 0;
  return { delay: chasing ? input.chaseMs : input.intervalMs, chasing };
}

export interface PollLoopOptions {
  /**
   * One poll. Resolves `true` when the payload says a block is due, which earns a chase. Must
   * not reject: a poll counts its own failures, which `failures` then reports.
   */
  poll: () => Promise<boolean>;
  /** Consecutive failed polls so far, read after each poll to choose the next delay. */
  failures: () => number;
  intervalMs: number;
  chaseMs: number;
  unavailableIntervalMs: number;
}

/**
 * Runs a poller: one poll at once, then each next delay chosen by `pollDelayMs`. A timeout chain
 * rather than an interval, so every poll picks its own successor's delay; the chase budget
 * refills whenever a payload is consistent, so only a persistently stale upstream exhausts it.
 * Coming back to a hidden tab polls immediately, so it shows the chain now rather than at the
 * next tick.
 *
 * Returns the teardown, which stops scheduling; aborting an in-flight request is the caller's.
 */
export function runPollLoop(options: PollLoopOptions): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;
  let chasesLeft = MAX_CHASES;

  const run = async () => {
    const blockDue = await options.poll();
    if (cancelled) return;
    if (!blockDue) chasesLeft = MAX_CHASES;
    const { delay, chasing } = pollDelayMs({
      failures: options.failures(),
      blockDue,
      chasesLeft,
      intervalMs: options.intervalMs,
      chaseMs: options.chaseMs,
      unavailableIntervalMs: options.unavailableIntervalMs,
    });
    if (chasing) chasesLeft -= 1;
    timer = setTimeout(() => void run(), delay);
  };
  void run();

  const onVisible = () => {
    if (!document.hidden) void options.poll();
  };
  document.addEventListener("visibilitychange", onVisible);

  return () => {
    cancelled = true;
    if (timer !== undefined) clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
