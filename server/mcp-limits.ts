import { V1_EXPENSIVE_LIMITS } from "./v1/descriptor";

type Group = keyof typeof V1_EXPENSIVE_LIMITS;
interface RateWindow {
  events: number;
  windowSeconds: number;
}

/** Counters kept at most; past this, expired windows are dropped, then everything if needed. */
const MAX_COUNTERS = 20_000;

const GROUP_PATTERNS: ReadonlyArray<readonly [Group, RegExp]> = (
  Object.keys(V1_EXPENSIVE_LIMITS) as Group[]
).flatMap((group) =>
  V1_EXPENSIVE_LIMITS[group].appliesTo.map(
    (path) => [group, new RegExp(`^${path.replace(/\{[^}]+\}/g, "[^/]+")}$`)] as const,
  ),
);

/**
 * The per-endpoint limits Caddy applies to the costliest `/v1` reads, applied again to MCP tool
 * calls, which reach those endpoints in-process and so never pass Caddy's zones.
 *
 * Counts live in memory in fixed windows and are never persisted: the same terms as Caddy's own
 * limiter, so no caller identity outlives its window.
 */
export class ExpensiveToolLimiter {
  /** Per counter: which fixed window it counts, how many so far, and when that window ends. */
  readonly #counts = new Map<string, { windowIndex: number; count: number; endsAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Which limit group a `/v1` path belongs to, or null for the ordinary endpoints. */
  static groupOf(path: string): Group | null {
    const pathname = path.split("?", 1)[0] ?? "";
    for (const [group, pattern] of GROUP_PATTERNS) if (pattern.test(pathname)) return group;
    return null;
  }

  /**
   * Counts one call by `client` to `path`. Returns 0 when it may proceed, otherwise the seconds
   * until it may; a refused call is not counted.
   */
  take(path: string, client: string): number {
    const group = ExpensiveToolLimiter.groupOf(path);
    if (group === null) return 0;
    const limits = V1_EXPENSIVE_LIMITS[group];
    const checks: Array<[string, RateWindow]> = [
      [`${group}|burst|${client}`, limits.perIpBurst],
      [`${group}|sustained|${client}`, limits.perIpSustained],
      [`${group}|global`, limits.globalCeiling],
    ];
    const nowMs = this.now();
    let wait = 0;
    for (const [key, window] of checks) {
      const span = window.windowSeconds * 1000;
      const index = Math.floor(nowMs / span);
      const entry = this.#counts.get(key);
      const count = entry && entry.windowIndex === index ? entry.count : 0;
      if (count >= window.events) {
        wait = Math.max(wait, Math.ceil(((index + 1) * span - nowMs) / 1000));
      }
    }
    if (wait > 0) return wait;
    for (const [key, window] of checks) {
      const span = window.windowSeconds * 1000;
      const index = Math.floor(nowMs / span);
      const entry = this.#counts.get(key);
      this.#counts.set(key, {
        windowIndex: index,
        count: entry && entry.windowIndex === index ? entry.count + 1 : 1,
        endsAt: (index + 1) * span,
      });
    }
    this.#prune(nowMs);
    return 0;
  }

  #prune(nowMs: number): void {
    if (this.#counts.size <= MAX_COUNTERS) return;
    for (const [key, entry] of this.#counts) if (entry.endsAt <= nowMs) this.#counts.delete(key);
    if (this.#counts.size > MAX_COUNTERS) this.#counts.clear();
  }
}

/**
 * The calling address as Caddy reports it. Caddy sets `X-Forwarded-For` itself; the last entry
 * is the one it added, so a value the client sent earlier in the header cannot pick its own key.
 */
export function forwardedClient(header: string | undefined): string {
  const parts = (header ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.at(-1) ?? "unknown";
}
