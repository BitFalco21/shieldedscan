import { NU7_HEIGHT, nu6MinerSubsidyZat, targetSpacingAt, type BlockSummary } from "@/domain";

/**
 * The NU7 countdown's decisions, as pure functions: which URL shows it, how far the chain has
 * to go, when it probably gets there, and what the heartbeat trace draws.
 *
 * Heights are exact; every time here is an estimate at the current block target, measured from
 * the newest block's own timestamp, and is labelled as one where it is shown.
 */

/**
 * Whether a missing block at `/block/<id>` is the NU7 activation block, which renders the
 * countdown instead of a 404. Only the canonical height spelling: a hash, a leading zero or a
 * sign is a different URL and keeps the normal answer. Never on testnet, where NU7 is active.
 */
export function isNu7CountdownId(id: string, testnet: boolean): boolean {
  return !testnet && id === String(NU7_HEIGHT);
}

export function blocksToGo(tipHeight: number): number {
  return Math.max(0, NU7_HEIGHT - tipHeight);
}

/** Estimated unix seconds of the activation block: the newest block's time plus N targets. */
export function activationEtaSeconds(tipHeight: number, tipTimestamp: number): number {
  return tipTimestamp + blocksToGo(tipHeight) * targetSpacingAt(tipHeight);
}

export interface ClockPart {
  label: "days" | "hrs" | "min" | "sec";
  value: string;
}

/**
 * The estimate as clock digits, days only when there is at least one, or null once it is due
 * (a late block reads as "any moment", never as a negative clock).
 */
export function clockParts(seconds: number): ClockPart[] | null {
  if (seconds < 1) return null;
  const s = Math.floor(seconds);
  const pad = (n: number) => String(n).padStart(2, "0");
  const days = Math.floor(s / 86_400);
  const parts: ClockPart[] = [
    { label: "hrs", value: pad(Math.floor((s % 86_400) / 3_600)) },
    { label: "min", value: pad(Math.floor((s % 3_600) / 60)) },
    { label: "sec", value: pad(s % 60) },
  ];
  return days > 0 ? [{ label: "days", value: pad(days) }, ...parts] : parts;
}

/** ZEC to at most four decimals, trailing zeros dropped: "1.25", "0.4167". */
export function formatZecShort(zat: number): string {
  return String(Number((zat / 1e8).toFixed(4)));
}

/** What the activation block changes, from the protocol schedule. */
export const NU7_CHANGES = {
  spacingBefore: targetSpacingAt(NU7_HEIGHT - 1),
  spacingAfter: targetSpacingAt(NU7_HEIGHT),
  minerBeforeZat: nu6MinerSubsidyZat(NU7_HEIGHT - 1),
  minerAfterZat: nu6MinerSubsidyZat(NU7_HEIGHT),
} as const;

/**
 * How far back the heartbeat reaches: forty minutes, or fifteen on a phone, where forty would
 * pack the spikes into a solid band. And how many blocks it keeps to draw the longer one.
 */
export const HEARTBEAT_WINDOW_MINUTES = { wide: 40, narrow: 15 } as const;
export const HEARTBEAT_BLOCKS = 48;
/** Where "now" sits across the trace; the rest is the projected future. */
export const HEARTBEAT_NOW_X = 0.86;

/** The visible future for a window, at the same scale as the past. */
export function futureSeconds(windowSeconds: number): number {
  return (windowSeconds * (1 - HEARTBEAT_NOW_X)) / HEARTBEAT_NOW_X;
}

export interface HeartbeatModel {
  /** One per real block in the window, at its own timestamp (clamped to now). */
  spikes: { t: number; height: number }[];
  /** Where the next blocks would land at the target spacing, after now. */
  projected: number[];
  /** The projected activation, when it falls inside the visible future. */
  marker: number | null;
  blocksLeft: number;
  /** The target the projection uses: 75 s before NU7, 25 s from it. */
  step: number;
}

export function heartbeatModel(
  blocks: readonly BlockSummary[],
  tip: { height: number; lastBlockTimestamp: number },
  now: number,
  windowSeconds: number,
): HeartbeatModel {
  const ahead = futureSeconds(windowSeconds);
  const step = targetSpacingAt(tip.height);
  const blocksLeft = blocksToGo(tip.height);
  const spikes = blocks
    .filter((b) => b.timestamp >= now - windowSeconds)
    .map((b) => ({ t: Math.min(b.timestamp, now), height: b.height }));

  const projected: number[] = [];
  for (let i = 1; ; i += 1) {
    const t = tip.lastBlockTimestamp + i * step;
    if (t > now + ahead) break;
    if (t > now && i !== blocksLeft) projected.push(t);
  }

  // A late block puts the estimate in the past; the marker then waits at "now".
  const eta = Math.max(now, activationEtaSeconds(tip.height, tip.lastBlockTimestamp));
  const marker = blocksLeft > 0 && eta <= now + ahead ? eta : null;
  return { spikes, projected, marker, blocksLeft, step };
}

/** How many blocks after the activation its page charts. */
export const FIRST_NU7_BLOCKS = 8;

/**
 * One row per block after the activation, while the run is unbroken: the real time since its
 * parent, from the two blocks' own timestamps.
 */
export function firstNu7Intervals(
  blocks: readonly BlockSummary[],
): { height: number; seconds: number }[] {
  const byHeight = new Map(blocks.map((b) => [b.height, b.timestamp]));
  const rows: { height: number; seconds: number }[] = [];
  for (let h = NU7_HEIGHT + 1; h <= NU7_HEIGHT + FIRST_NU7_BLOCKS; h += 1) {
    const at = byHeight.get(h);
    const parent = byHeight.get(h - 1);
    if (at === undefined || parent === undefined) break;
    rows.push({ height: h, seconds: at - parent });
  }
  return rows;
}

/**
 * Fold one poll's blocks into the recent list, newest first. Keyed by height so a reorg's new
 * hash replaces the old one, and cut at the tip so blocks a reorg removed drop out.
 */
export function mergeRecent(
  current: readonly BlockSummary[],
  incoming: readonly BlockSummary[],
  tipHeight: number,
): BlockSummary[] {
  const byHeight = new Map<number, BlockSummary>();
  for (const b of current) byHeight.set(b.height, b);
  for (const b of incoming) byHeight.set(b.height, b);
  return [...byHeight.values()]
    .filter((b) => b.height <= tipHeight)
    .sort((a, b) => b.height - a.height)
    .slice(0, HEARTBEAT_BLOCKS);
}

/**
 * `counting` until the tip reaches the height, then `activating` (the animation) when that was
 * seen live, then `awaiting` while the server catches up with the block. A page first rendered
 * at or past the height skips the animation: nobody watched it happen.
 */
export type CountdownPhase = "counting" | "activating" | "awaiting";

export function initialPhase(tipHeight: number): CountdownPhase {
  return tipHeight >= NU7_HEIGHT ? "awaiting" : "counting";
}

export function nextPhase(
  phase: CountdownPhase,
  tipHeight: number,
  reducedMotion: boolean,
): CountdownPhase {
  if (phase !== "counting" || tipHeight < NU7_HEIGHT) return phase;
  return reducedMotion ? "awaiting" : "activating";
}
