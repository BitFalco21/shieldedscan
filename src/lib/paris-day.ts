const ZONE = "Europe/Paris";

// `en-CA` formats as YYYY-MM-DD, which is the shape we key on. Intl carries the tz
// database, so DST needs no table of our own and no annual maintenance.
const DAY_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
// `hourCycle: "h23"`, not `hour12: false`: some ICU builds render midnight as "24" under
// `hour12`, which `dueForDailyPost`'s `>=` would read as due. Do not add `hour12` alongside:
// when both are present it takes precedence over `hourCycle`.
const HOUR_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: ZONE,
  hour: "2-digit",
  hourCycle: "h23",
});

/** The Paris calendar date, `YYYY-MM-DD`. The ledger key for the daily post. */
export function parisDay(nowMs: number): string {
  return DAY_FMT.format(new Date(nowMs));
}

/** The hour of the Paris clock, 0–23. */
export function parisHour(nowMs: number): number {
  return Number(HOUR_FMT.format(new Date(nowMs)));
}

/**
 * Has the posting hour arrived in Paris today?
 *
 * True for the rest of the Paris day, so one failed poll does not lose the day's post.
 * Exactly-once is enforced by the ledger's primary key, never by this predicate.
 */
export function dueForDailyPost(nowMs: number, postHour: number): boolean {
  return parisHour(nowMs) >= postHour;
}
