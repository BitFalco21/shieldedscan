/**
 * One day of network health: difficulty and block size, both averaged across the day.
 *
 * Means are appropriate here (unlike fees): difficulty adjusts smoothly and block size is
 * bounded by consensus (2 MB), so neither has a heavy tail. Low block utilisation means no
 * congestion, not no usage.
 */
export interface NetworkDayPoint {
  /** Unix seconds at the day start. */
  timestamp: number;
  /**
   * `null` where the index holds no difficulty for that day — never coerce it to zero, which
   * proof-of-work cannot produce. Charts draw a gap (`MultiLineChart` splits on nulls).
   */
  avgDifficulty: number | null;
  avgBlockBytes: number;
}
