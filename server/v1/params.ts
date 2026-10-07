import { POOL_NAMES, isOneOf, parseUtcDayStart, type PoolName } from "@/domain";
import { DAY_SECONDS } from "@/domain/time";
import type { CacheClass } from "./http";

/**
 * Query parsing shared across `/v1`. Every parameter is strict: a value this API cannot read is a
 * 400 naming it, never a silent "all", because a widened answer to a narrowed question is
 * well-formed and wrong. The private `/chain/*` routes coerce instead, since their one caller ships
 * in lockstep with them and reads the echo; a stranger's client (often an AI agent doing function
 * calling) cannot see that.
 */

/**
 * A malformed or unknown parameter, answered as a 400 that names it. `cacheClass`, when set, is
 * the Cache-Control the 400 carries.
 */
export class ParamError extends Error {
  readonly code: "invalid_parameter" | "unknown_parameter";
  readonly cacheClass: CacheClass | undefined;
  constructor(
    code: "invalid_parameter" | "unknown_parameter",
    message: string,
    cacheClass?: CacheClass,
  ) {
    super(message);
    this.code = code;
    this.cacheClass = cacheClass;
  }
}

/** `interval=day` answers at most this many days per request: the payload bound. */
export const MAX_DAY_BUCKETS = 366;

/** How a 400 lists what an endpoint accepts: an endpoint taking no parameters says "none". */
export function acceptedParams(allowed: readonly string[]): string {
  return allowed.length === 0 ? "none" : allowed.join(", ");
}

/** A 400 for any query parameter outside `allowed`, so a typo can never widen an answer. */
export function rejectUnknown(query: Record<string, string>, allowed: readonly string[]): void {
  const unknown = Object.keys(query).filter((k) => !allowed.includes(k));
  if (unknown.length > 0) {
    throw new ParamError(
      "unknown_parameter",
      `unknown parameter${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}; this endpoint accepts ${acceptedParams(allowed)}`,
    );
  }
}

const V1_POOL_LIST = POOL_NAMES.join(" | ");

/** A shielded pool name, or `undefined` when absent. */
export function parsePoolParam(raw: string | undefined): PoolName | undefined {
  if (raw === undefined || raw === "") return undefined;
  const pool = raw.trim().toLowerCase();
  if (!isOneOf(POOL_NAMES, pool)) {
    throw new ParamError("invalid_parameter", `pool: ${V1_POOL_LIST}`);
  }
  return pool;
}

/**
 * Optional `from`/`to` UTC days, `from` inclusive and `to` exclusive, as unix seconds; null where
 * absent. The daily series and the miner window both read their window this way.
 */
export function parseOptionalDayEdges(q: Record<string, string>): {
  fromTs: number | null;
  toTs: number | null;
} {
  const edge = (name: "from" | "to"): number | null => {
    const raw = q[name];
    if (raw === undefined || raw === "") return null;
    const ts = parseUtcDayStart(raw);
    if (ts === null) {
      throw new ParamError("invalid_parameter", `${name} must be a UTC day: YYYY-MM-DD`);
    }
    return ts;
  };
  const fromTs = edge("from");
  const toTs = edge("to");
  if (fromTs !== null && toTs !== null && toTs <= fromTs) {
    throw new ParamError("invalid_parameter", "to must be a later day than from (to is exclusive)");
  }
  return { fromTs, toTs };
}

/**
 * A half-open window of whole UTC days, `from` inclusive and `to` exclusive — the convention every
 * windowed endpoint here uses, so a calendar month is counted once. Either edge may be absent.
 * The result is in unix seconds, ready to bound a `timestamp` column.
 */
export function parseDayWindow(
  from: string | undefined,
  to: string | undefined,
): { fromTs?: number; toTs?: number } {
  const out: { fromTs?: number; toTs?: number } = {};
  if (from !== undefined && from !== "") {
    const ts = parseUtcDayStart(from);
    if (ts === null) {
      throw new ParamError("invalid_parameter", "from must be a real UTC day, YYYY-MM-DD");
    }
    out.fromTs = ts;
  }
  if (to !== undefined && to !== "") {
    const ts = parseUtcDayStart(to);
    if (ts === null)
      throw new ParamError("invalid_parameter", "to must be a real UTC day, YYYY-MM-DD");
    out.toTs = ts;
  }
  if (out.fromTs !== undefined && out.toTs !== undefined && out.fromTs >= out.toTs) {
    throw new ParamError("invalid_parameter", "from must be before to (to is exclusive)");
  }
  return out;
}

/**
 * An instant for `?at=`, in unix seconds, or null when unreadable.
 *
 * Three forms: unix seconds; an ISO time in UTC (`2024-05-28T12:00:00Z`, seconds optional); or a
 * bare day, which means the END of that UTC day — "the blocks at 2024-05-28" then starts with that
 * day's last block and walks back through it, which is what the question means. A start-of-day
 * reading would hand back the previous day's last block, and nobody asking about a date wants that.
 *
 * Every calendar part is round-tripped, because `Date.parse` rolls an impossible day over into
 * the next month instead of failing (`2026-02-31` lands in March).
 */
export function parseAtParam(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const s = raw.trim();
  if (/^\d{9,10}$/.test(s)) return Number(s);
  const day = /^(\d{4}-\d{2}-\d{2})$/.exec(s);
  if (day) {
    const start = parseUtcDayStart(day[1]);
    return start === null ? null : start + DAY_SECONDS - 1;
  }
  const iso = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?Z$/.exec(s);
  if (!iso) return null;
  const start = parseUtcDayStart(iso[1]);
  const [h, m, sec] = [Number(iso[2]), Number(iso[3]), Number(iso[4] ?? "0")];
  if (start === null || h > 23 || m > 59 || sec > 59) return null;
  return start + h * 3600 + m * 60 + sec;
}
