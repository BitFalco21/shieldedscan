/** Seconds in a UTC day. Unix time has no leap seconds, so every day is exactly this long. */
export const DAY_SECONDS = 86_400;
export const DAY_MS = DAY_SECONDS * 1_000;

/** The UTC calendar day (`YYYY-MM-DD`) a unix timestamp in seconds falls on. */
export function utcDayFromSeconds(seconds: number): string {
  return new Date(seconds * 1_000).toISOString().slice(0, 10);
}

/** The UTC calendar day (`YYYY-MM-DD`) a millisecond timestamp falls on. */
export function utcDayFromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
