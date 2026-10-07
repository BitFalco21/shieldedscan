import { DAY_SECONDS } from "@/domain";

/**
 * Formatters specific to mining figures.
 *
 * Separate from `lib/format.ts` because these carry domain judgement — which unit is correct,
 * and how much precision a measurement can honestly claim — rather than being pure
 * presentation of a scalar.
 */

const SOL_UNITS = ["Sol/s", "kSol/s", "MSol/s", "GSol/s", "TSol/s", "PSol/s"] as const;

/**
 * A solution rate, in the unit Equihash actually produces.
 *
 * Solutions, never hashes: Equihash's unit of work is a solution to the underlying birthday
 * problem, not a hash attempt, and printing "MH/s" against it is a category error.
 *
 * Three significant figures, because the input is a sample from a Poisson process and any
 * further digits would be noise dressed as measurement.
 */
export function formatSolRate(solps: number): string {
  if (!Number.isFinite(solps) || solps <= 0) return "0 Sol/s";
  const tier = Math.min(SOL_UNITS.length - 1, Math.floor(Math.log10(solps) / 3));
  const scaled = solps / 1000 ** tier;
  return `${scaled.toLocaleString("en-US", { maximumSignificantDigits: 3 })} ${SOL_UNITS[tier]}`;
}

/** Difficulty, a bare ratio — abbreviated because the full integer says nothing extra. */
export function formatDifficulty(difficulty: number): string {
  if (!Number.isFinite(difficulty)) return "unknown";
  if (difficulty >= 1e9) return `${(difficulty / 1e9).toFixed(2)}B`;
  if (difficulty >= 1e6) return `${(difficulty / 1e6).toFixed(2)}M`;
  if (difficulty >= 1e3) return `${(difficulty / 1e3).toFixed(2)}k`;
  return difficulty.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/**
 * A duration in seconds, as a miner-interval reads.
 *
 * Whole seconds under two minutes because block times are compared at that resolution;
 * minutes and hours above, because "9,432s" is a number a reader has to do arithmetic on.
 */
export function formatInterval(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "unknown";
  if (seconds < 120) return `${Math.round(seconds)}s`;
  if (seconds < 7200) return `${(seconds / 60).toFixed(1)} min`;
  if (seconds < 172_800) return `${(seconds / 3600).toFixed(1)} h`;
  return `${(seconds / DAY_SECONDS).toFixed(1)} d`;
}

/**
 * A percentage with one decimal.
 *
 * Never rendered on its own: the denominator sits beside it, so every caller pairs this with
 * the block counts it came from.
 */
export function formatPct(pct: number): string {
  return `${pct.toFixed(1)}%`;
}
