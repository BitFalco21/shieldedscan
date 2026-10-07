import { Hono, type Context } from "hono";
import type { Pool } from "pg";
import { loadMinerWindow, type MinerWindow } from "../mining-daily";
import { DAY_SECONDS, utcDayFromSeconds } from "@/domain/time";
import { MAINNET_SITE_URL as SITE } from "@/lib/network";
import { amount } from "./format";
import { ParamError, parseOptionalDayEdges, rejectUnknown } from "./params";
import { routeGroupErrors, setCache } from "./http";
import { createKeyedCache } from "./keyed-cache";
import { share } from "./map";

/**
 * `/v1/analytics/miners`: who mined a window of UTC days, by payout address — blocks, share,
 * the miner's own reward and fees, and the coinbase tag of each address's newest block. Read from
 * `mining_day_payout`, so any window, all of history included, is a sum over ~51k stored rows.
 *
 * No names: `/v1` publishes no attribution, so a row is its address. The tag is the miner's own
 * bytes, served verbatim as `/v1/blocks/{id}` serves it; it is text a miner chose and verifies
 * nobody.
 *
 * Every share is of every block in the window, and two addresses are never merged, so a share or
 * a concentration figure is a lower bound for any operator behind several addresses.
 *
 * Cost bounds: its own two-connection pool (a caller waits at most five seconds, then 503), a
 * response cache (six hours for a settled window, ten minutes otherwise), and the Caddy
 * `v1_analytics` zones.
 */

export const V1_MINERS_PATH = "/v1/analytics/miners";

const SETTLED_TTL_MS = 6 * 60 * 60 * 1000;
const OPEN_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 500;
export const MINERS_DEFAULT_LIMIT = 25;
export const MINERS_MAX_LIMIT = 100;

export interface V1MinersDeps {
  pool: Pool;
  now?: () => number;
  /** Injectable so the HTTP contract is testable without a database. */
  load?: typeof loadMinerWindow;
}

function parseLimit(raw: string | undefined): number {
  if (raw === undefined || raw === "") return MINERS_DEFAULT_LIMIT;
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || n < 1 || n > MINERS_MAX_LIMIT) {
    throw new ParamError(
      "invalid_parameter",
      `limit must be an integer from 1 to ${MINERS_MAX_LIMIT}`,
    );
  }
  return n;
}

export function v1MinersRoutes(deps: V1MinersDeps): Hono {
  const app = new Hono();
  const now = deps.now ?? Date.now;
  const load = deps.load ?? loadMinerWindow;
  const nowSec = () => Math.floor(now() / 1000);
  const cached = createKeyedCache({ now, max: CACHE_MAX });

  app.onError(routeGroupErrors("the mining index could not answer just now; retry shortly"));

  app.get(V1_MINERS_PATH, async (c: Context) => {
    const q = c.req.query();
    rejectUnknown(q, ["from", "to", "limit"]);
    const { fromTs: fromRaw, toTs: toRaw } = parseOptionalDayEdges(q);
    const limit = parseLimit(q.limit);
    const todayStart = Math.floor(nowSec() / DAY_SECONDS) * DAY_SECONDS;
    // Absent edges are the whole chain: from its first day through today.
    const fromTs = fromRaw ?? 0;
    const toTs = toRaw ?? todayStart + DAY_SECONDS;
    // The tracker recomputes the newest three days; a window is settled once it ends before them.
    const settledEdge = todayStart - 2 * DAY_SECONDS;
    // Settled: no day it covers can still change, every one of them is computed, and every block
    // in it has a recorded miner. An answer read before the tracker reached the window is EMPTY,
    // and caching it for hours would publish "nothing was mined" for a month that was.
    const isSettled = (win: MinerWindow) =>
      toTs <= settledEdge &&
      win.unrecordedBlocks === 0 &&
      win.daysComputed === expectedDays(win, fromTs, toTs, todayStart);
    const w = await cached(
      `${fromTs}:${toTs}:${limit}`,
      (win: MinerWindow) => (isSettled(win) ? SETTLED_TTL_MS : OPEN_TTL_MS),
      () => load(deps.pool, fromTs, toTs, limit),
    );
    const settled = isSettled(w);
    const body = minersBody(w, {
      from: fromRaw === null ? null : utcDayFromSeconds(fromRaw),
      to: toRaw === null ? null : utcDayFromSeconds(toRaw),
      limit,
      fromTs,
      toTs,
      todayStart,
      asOf: nowSec(),
    });
    setCache(c, settled ? "settledWindow" : "openWindow");
    return c.json(body);
  });

  return app;
}

/**
 * How many days the window SHOULD hold: its days that fall between the chain's first day and the
 * end of today. A window entirely before the chain or after today expects none.
 */
function expectedDays(w: MinerWindow, fromTs: number, toTs: number, todayStart: number): number {
  if (w.chainFirstDay === null) return 0;
  const lo = Math.max(fromTs, w.chainFirstDay);
  const hi = Math.min(toTs, todayStart + DAY_SECONDS);
  return hi > lo ? Math.round((hi - lo) / DAY_SECONDS) : 0;
}

interface BodyContext {
  from: string | null;
  to: string | null;
  limit: number;
  fromTs: number;
  toTs: number;
  todayStart: number;
  asOf: number;
}

/** The response, from a loaded window. */
function minersBody(w: MinerWindow, ctx: BodyContext) {
  const unknowns: Record<string, string> = {};
  const total = w.blocks;
  const shareOf = (n: number, path: string) => {
    const s = share(n, total);
    if (s === null) unknowns[path] = "nonexistent";
    return s;
  };
  const notes: string[] = [];
  const expected = expectedDays(w, ctx.fromTs, ctx.toTs, ctx.todayStart);
  if (w.daysComputed < expected) {
    notes.push(
      `${(expected - w.daysComputed).toLocaleString("en-US")} of the ${expected.toLocaleString("en-US")} days in this window are not computed yet; their blocks are not counted.`,
    );
  }
  if (w.unrecordedBlocks > 0) {
    notes.push(
      `${w.unrecordedBlocks.toLocaleString("en-US")} block(s) in this window have no recorded miner yet; they count in every share's denominator, so the shares below are lower bounds until they are filled.`,
    );
  }
  if (ctx.toTs > ctx.todayStart) {
    notes.push(
      "The window includes today's unfinished UTC day, counted as of the last ten-minute refresh.",
    );
  }
  const listed = w.top;
  const listedBlocks = listed.reduce((s, r) => s + r.blocks, 0);
  const restAddresses = w.transparent.addresses - listed.length;
  const miners = listed.map((r, i) => {
    if (r.rewardZat === null) unknowns[`data.miners.${i}.reward`] = "unmeasured";
    if (r.feeZat === null) unknowns[`data.miners.${i}.fees`] = "unmeasured";
    return {
      rank: r.rank,
      address: r.address,
      blocks: r.blocks,
      share: shareOf(r.blocks, `data.miners.${i}.share`),
      reward: r.rewardZat === null ? null : amount(r.rewardZat),
      fees: r.feeZat === null ? null : amount(r.feeZat),
      firstHeight: r.firstHeight,
      lastHeight: r.lastHeight,
      newestBlock: { height: r.lastHeight, coinbaseTag: r.newestCoinbaseTag },
    };
  });
  return {
    query: { from: ctx.from, to: ctx.to, limit: ctx.limit },
    coverage: { status: notes.length === 0 ? ("complete" as const) : ("partial" as const), notes },
    source: { name: "ShieldedScan", url: `${SITE}/mining` },
    basis:
      "blocks grouped by the payout address of each coinbase's largest output, which is the miner by consensus. Two addresses are never merged, so an operator paid at several addresses appears as several and every share and concentration figure is a lower bound for any operator. Shares are of every block in the window. reward is everything the miner's coinbase outputs paid it, its fees included; fees is that included part — never add the two. coinbaseTag is text the miner wrote into its block and identifies nobody verifiably. A shielded coinbase (ZIP 213) has no payout address, and some miners until 2018 paid a bare public key, which has no address form; both are counted apart.",
    data: {
      fromHeight: w.fromHeight,
      toHeight: w.toHeight,
      blocks: total,
      byKind: {
        transparent: {
          blocks: w.transparent.blocks,
          addresses: w.transparent.addresses,
          share: shareOf(w.transparent.blocks, "data.byKind.transparent.share"),
        },
        shieldedCoinbase: {
          blocks: w.shieldedBlocks,
          share: shareOf(w.shieldedBlocks, "data.byKind.shieldedCoinbase.share"),
        },
        noAddress: {
          blocks: w.noAddressBlocks,
          share: shareOf(w.noAddressBlocks, "data.byKind.noAddress.share"),
        },
        unrecorded: {
          blocks: w.unrecordedBlocks,
          share: shareOf(w.unrecordedBlocks, "data.byKind.unrecorded.share"),
        },
      },
      concentration: {
        top1: shareOf(w.topBlocks.top1, "data.concentration.top1"),
        top3: shareOf(w.topBlocks.top3, "data.concentration.top3"),
        top10: shareOf(w.topBlocks.top10, "data.concentration.top10"),
      },
      miners,
      rest:
        restAddresses > 0
          ? {
              addresses: restAddresses,
              blocks: w.transparent.blocks - listedBlocks,
              share: shareOf(w.transparent.blocks - listedBlocks, "data.rest.share"),
            }
          : null,
    },
    unknowns,
    asOf: ctx.asOf,
  };
}
