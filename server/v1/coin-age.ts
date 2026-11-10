import { Hono } from "hono";
import type { Pool } from "pg";
import {
  COIN_AGE_BANDS,
  coinAgeBands,
  coinAgeTotalZat,
  type CoinAgeCell,
  type CoinAgePoint,
  type CoinAgeSeries,
} from "@/domain/coin-age";
import { MAINNET_SITE_URL as SITE } from "@/lib/network";
import { Cached } from "../cached";
import { coinAgeState, loadCoinAgeDays, loadLatestCells, loadMonthEndCells } from "../coin-age";

export { monthEndsThrough } from "../coin-age";
import "../pg-types";
import { amount } from "./format";
import { routeGroupErrors, setCache } from "./http";
import { parseOptionalDayEdges, rejectUnknown } from "./params";

/**
 * `/v1/analytics/coin-age`: how long the ZEC in transparent outputs has sat unspent, at the end of
 * every month and at the newest block the table covers. Each point's bands add up to the node's
 * transparent pool at the height it names, to the zatoshi.
 */

export const V1_COIN_AGE_PATH = "/v1/analytics/coin-age";

/** The pure step from cells to points, so the banding is tested without a database. */
export function pointsFromCells(
  cells: readonly { asOf: string; creationDay: string; valueZat: number; outputs: number }[],
  heights: ReadonlyMap<string, number>,
): CoinAgePoint[] {
  const byDay = new Map<string, CoinAgeCell[]>();
  for (const c of cells) {
    const list = byDay.get(c.asOf) ?? [];
    list.push(c);
    byDay.set(c.asOf, list);
  }
  return [...heights.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([asOf, height]) => ({ asOf, height, bands: coinAgeBands(byDay.get(asOf) ?? [], asOf) }));
}

export const COIN_AGE_BASIS =
  "every transparent output this explorer indexes, by the UTC day of the block that created it and whether a block had spent it by the end of the day measured. A block's day is the latest header day at or below its height, so each day ends at one height (`height`) and the bands at a point add up to the node's transparent pool at that height, to the zatoshi. Bands are calendar spans back from the day measured: `1m3m` is created after the same date three months earlier and on or before the same date one month earlier. An address is not a holder: one wallet moving coins between its own addresses resets their age. `outputs` includes unspendable zero-value OP_RETURN outputs, which are never spent and so end in the oldest band; value is unaffected.";

const share = (numerator: number, denominator: number) => ({
  pct: denominator === 0 ? 0 : Math.round((numerator / denominator) * 10_000) / 100,
  numerator,
  denominator,
});

function wirePoint(p: CoinAgePoint) {
  const total = coinAgeTotalZat(p);
  return {
    asOf: p.asOf,
    height: p.height,
    total: amount(total),
    bands: p.bands.map((b) => ({
      key: b.key,
      value: amount(b.valueZat),
      outputs: b.outputs,
      share: share(b.valueZat, total),
    })),
  };
}

/**
 * How far below the chain's tip the newest point may sit before the answer says it is behind:
 * about a day of blocks at the 75-second target, far past the reorg depth the tracker always
 * trails by and the ten minutes between its passes. A refused range stops the tracker until a
 * restart, and without this the newest point would age with nothing saying so.
 */
export const COIN_AGE_STALE_BLOCKS = 1_152;

export function buildCoinAge(
  series: CoinAgeSeries,
  fromDay: string | null,
  toDay: string | null,
  tipHeight: number | null = null,
) {
  const kept = series.monthEnds.filter(
    (p) => (fromDay === null || p.asOf >= fromDay) && (toDay === null || p.asOf < toDay),
  );
  const notes: string[] = [];
  if (series.latest === null) notes.push("Nothing is computed yet.");
  else if (tipHeight !== null && tipHeight - series.latest.height > COIN_AGE_STALE_BLOCKS) {
    notes.push(
      `The newest point is at block ${series.latest.height}, ${tipHeight - series.latest.height} blocks below the chain's tip at ${tipHeight}: the table has fallen behind.`,
    );
  }
  return {
    coverage: { status: notes.length === 0 ? ("complete" as const) : ("partial" as const), notes },
    data: {
      bands: COIN_AGE_BANDS.map((b) => ({ key: b.key, label: b.label })),
      monthEnds: kept.map(wirePoint),
      latest: series.latest === null ? null : wirePoint(series.latest),
    },
    unknowns: series.latest === null ? { "data.latest": "unmeasured" } : {},
  };
}

/**
 * Everything the route serves: the stored month-ends (`coin_age_month_end`, written once each month
 * closes) and the newest applied block, from the matrix's unspent rows. Three short reads.
 */
export async function loadCoinAgeSeries(pool: Pick<Pool, "query">): Promise<CoinAgeSeries> {
  const state = await coinAgeState(pool);
  if (state === null || state.appliedDay === null) return { monthEnds: [], latest: null };
  const [days, monthCells, latestCells] = await Promise.all([
    loadCoinAgeDays(pool),
    loadMonthEndCells(pool),
    loadLatestCells(pool, state.appliedDay),
  ]);
  // Each month-end's closing height: the last block of the latest day at or before it.
  const heights = new Map<string, number>();
  let d = 0;
  for (const end of [...new Set(monthCells.map((c) => c.asOf))].sort()) {
    while (d + 1 < days.length && days[d + 1]!.day <= end) d += 1;
    if (days[d] && days[d]!.day <= end) heights.set(end, days[d]!.lastHeight);
  }
  const [latest] = pointsFromCells(latestCells, new Map([[state.appliedDay, state.appliedHeight]]));
  return { monthEnds: pointsFromCells(monthCells, heights), latest: latest ?? null };
}

/** The highest block the index holds: one read of the primary key's end. */
export async function loadTipHeight(pool: Pick<Pool, "query">): Promise<number | null> {
  const { rows } = await pool.query<{ tip: number | null }>("SELECT max(height) AS tip FROM block");
  return rows[0]?.tip ?? null;
}

// ------------------------------------------------------------------------------- route

const MEMO_MS = 10 * 60 * 1000;
const STALE_MS = 30 * 60 * 1000;

export interface V1CoinAgeDeps {
  pool: Pool;
  now?: () => number;
  /** Injectable so the HTTP contract is testable without a database. */
  load?: () => Promise<CoinAgeSeries>;
  /** The index's tip, to say when the newest point has fallen behind it. */
  tip?: () => Promise<number | null>;
}

export function v1CoinAgeRoutes(deps: V1CoinAgeDeps): Hono {
  const app = new Hono();
  const now = deps.now ?? Date.now;
  const load = deps.load ?? (() => loadCoinAgeSeries(deps.pool));
  const tip = deps.tip ?? (() => loadTipHeight(deps.pool));
  const memo = new Cached<{ series: CoinAgeSeries; tip: number | null }>(MEMO_MS, {
    staleMs: STALE_MS,
  });

  app.onError(routeGroupErrors("the chain index could not answer just now; retry shortly"));

  app.get(V1_COIN_AGE_PATH, async (c) => {
    const q = c.req.query();
    rejectUnknown(q, ["from", "to"]);
    parseOptionalDayEdges(q);
    const read = await memo.get(async () => {
      const [series, tipHeight] = await Promise.all([load(), tip()]);
      return { series, tip: tipHeight };
    });
    const built = buildCoinAge(read.series, q.from || null, q.to || null, read.tip);
    setCache(c, "series");
    return c.json({
      query: { from: q.from || null, to: q.to || null },
      coverage: built.coverage,
      source: { name: "ShieldedScan", url: `${SITE}/api-docs#analytics-coin-age` },
      basis: COIN_AGE_BASIS,
      data: built.data,
      unknowns: built.unknowns,
      asOf: Math.floor(now() / 1000),
    });
  });

  return app;
}
