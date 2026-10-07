import { Hono } from "hono";
import {
  PRICE_MAX_AGE_MS,
  type PriceQuote,
  type PriceTracker,
  type Stats24h,
  type Stats24hTracker,
} from "./chain-stats";

/**
 * The state a replica reads from the primary (see `api-role.ts`).
 *
 * Almost everything an API process serves is in Postgres or on the node, which a replica reads
 * directly. Two things live only in the primary's memory: the live ZEC price and the trailing
 * 24-hour transaction counts. The primary publishes both on one token-gated route, the replica
 * polls it in-network, and consumers in the replica read them through the same `current()` they
 * would call on the trackers.
 *
 * Staleness rules travel with the figures. A quote carries its `fetchedAt`, so the replica
 * withholds it at the same age the primary would (`PRICE_MAX_AGE_MS`). The counts carry the
 * primary's read time, and the replica withholds them once it has not heard from the primary in
 * `STATS_MAX_AGE_MS`: a figure that can no longer be refreshed is absent, never served as live.
 *
 * The in-memory snapshots only the agent reads (market caps and the ZIP index) are proxied on
 * demand instead (`primaryProxyRoutes`), since their routes return the snapshot verbatim.
 */

export const LIVE_STATE_PATH = "/chain/live-state";

/** Past this without a fresh read from the primary, the replica stops serving the 24-hour counts. */
export const STATS_MAX_AGE_MS = 5 * 60_000;

export interface LiveState {
  price: PriceQuote | null;
  stats24h: Stats24h | null;
  /** Unix milliseconds on the primary when it was read. */
  asOf: number;
}

export interface LiveStateRouteDeps {
  price?: Pick<PriceTracker, "current">;
  stats24h?: Pick<Stats24hTracker, "current">;
  now?: () => number;
}

/** The primary's half: its trackers' current figures, as their own `current()` returns them. */
export function liveStateRoutes(deps: LiveStateRouteDeps): Hono {
  const app = new Hono();
  const now = deps.now ?? Date.now;
  app.get(LIVE_STATE_PATH, (c) => {
    const body: LiveState = {
      price: deps.price?.current() ?? null,
      stats24h: deps.stats24h?.current() ?? null,
      asOf: now(),
    };
    c.header("Cache-Control", "no-store");
    return c.json(body);
  });
  return app;
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const count = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

/**
 * Strict, all-or-nothing. It is our own API, so this is a version-skew tripwire, not defence
 * against a hostile source: a payload of the wrong shape keeps the previous figures in place (and
 * ages them out on schedule) instead of serving something half-read.
 */
export function parseLiveState(body: unknown): LiveState | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (!finite(b.asOf)) return null;

  let price: PriceQuote | null = null;
  if (b.price !== null) {
    const p = b.price as Record<string, unknown> | undefined;
    if (typeof p !== "object" || p === null) return null;
    if (!finite(p.usd) || !finite(p.fetchedAt)) return null;
    if (p.change24hPct !== null && !finite(p.change24hPct)) return null;
    price = { usd: p.usd, change24hPct: p.change24hPct as number | null, fetchedAt: p.fetchedAt };
  }

  let stats24h: Stats24h | null = null;
  if (b.stats24h !== null) {
    const s = b.stats24h as Record<string, unknown> | undefined;
    if (typeof s !== "object" || s === null) return null;
    if (!count(s.txCount24h) || !count(s.blocks) || !finite(s.fullyShieldedPct24h)) return null;
    if (s.fullyShieldedPct24h < 0 || s.fullyShieldedPct24h > 100) return null;
    stats24h = {
      txCount24h: s.txCount24h,
      fullyShieldedPct24h: s.fullyShieldedPct24h,
      blocks: s.blocks,
    };
  }
  return { price, stats24h, asOf: b.asOf };
}

/** How a replica reaches the primary: the base URL and the service's own bearer header. */
export interface PrimaryLink {
  url: string;
  authorization: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

export interface RemoteLiveStateDeps extends PrimaryLink {
  log: (m: string) => void;
  now?: () => number;
  intervalMs?: number;
}

/** The replica's half: the primary's figures, polled, behind the trackers' own `current()`. */
export class RemoteLiveState {
  #state: LiveState | null = null;
  #failing = false;
  readonly #now: () => number;

  constructor(private readonly deps: RemoteLiveStateDeps) {
    this.#now = deps.now ?? Date.now;
  }

  readonly price: Pick<PriceTracker, "current"> = {
    current: (now = this.#now()) => {
      const quote = this.#state?.price ?? null;
      if (quote === null || now - quote.fetchedAt > PRICE_MAX_AGE_MS) return null;
      return quote;
    },
  };

  readonly stats24h: Pick<Stats24hTracker, "current"> = {
    current: () => {
      const state = this.#state;
      if (state === null || this.#now() - state.asOf > STATS_MAX_AGE_MS) return null;
      return state.stats24h;
    },
  };

  async refresh(): Promise<void> {
    const fetchFn = this.deps.fetch ?? globalThis.fetch;
    try {
      const res = await fetchFn(`${this.deps.url}${LIVE_STATE_PATH}`, {
        headers: { authorization: this.deps.authorization },
        signal: AbortSignal.timeout(this.deps.timeoutMs ?? 5_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const parsed = parseLiveState(await res.json());
      if (parsed === null) throw new Error("unrecognised live-state shape");
      this.#state = parsed;
      if (this.#failing) this.deps.log("live state: the primary answers again");
      this.#failing = false;
    } catch (error) {
      // Logged once per outage, not every ten seconds; the figures age out on their own.
      if (!this.#failing) {
        this.deps.log(`live state: could not read the primary — ${String(error)}`);
      }
      this.#failing = true;
    }
  }

  start(): () => void {
    void this.refresh();
    const timer = setInterval(() => void this.refresh(), this.deps.intervalMs ?? 10_000);
    timer.unref();
    return () => clearInterval(timer);
  }
}

/**
 * GET routes a replica answers by asking the primary, verbatim: status, body and content type.
 * For snapshots that live in the primary's memory and are served as they are. An unreachable
 * primary is a 503, the answer those routes already give when they have nothing to serve.
 */
export function primaryProxyRoutes(paths: readonly string[], link: PrimaryLink): Hono {
  const app = new Hono();
  const fetchFn = link.fetch ?? globalThis.fetch;
  for (const path of paths) {
    app.get(path, async (c) => {
      const search = new URL(c.req.url).search;
      try {
        const res = await fetchFn(`${link.url}${path}${search}`, {
          headers: { authorization: link.authorization },
          signal: AbortSignal.timeout(link.timeoutMs ?? 10_000),
        });
        return new Response(await res.arrayBuffer(), {
          status: res.status,
          headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
        });
      } catch {
        return c.json({ error: "the primary API could not be reached" }, 503);
      }
    });
  }
  return app;
}
