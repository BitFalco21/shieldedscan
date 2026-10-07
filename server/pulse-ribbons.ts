import type { Pool } from "pg";
import type {
  PoolName,
  PulseBlockPools,
  PulseEdgeTotal,
  PulseEnd,
  PulseRibbonsPayload,
  PulseRibbonWindow,
  PulseRibbonWindowName,
} from "@/domain";
import { issuanceZatBetween, POOL_NAMES, pulseChainNode, pulseZcashEnd } from "@/domain";
import type { CrossChainEdgeRow } from "./crosschain-store";
import { DAY_MS, utcDayFromMs } from "@/domain/time";

/**
 * The ribbons: cumulative gross flow along each edge over a window.
 *
 * Gross rather than net: two directions between the same pair are two ribbons, because a
 * difference between two totals is not a movement anybody made. The edges are independent totals,
 * not a budget: nothing claims that what left one box arrived in another, which is why ribbons
 * attach with gaps and the mined edges are measured from issuance.
 *
 * Everything is read from day-grained matviews, so a window is a sum over thousands of rows. The
 * windows are therefore UTC-day aligned: the day is the grain the data has.
 */

/**
 * The windows the page offers, in days, `null` being all of history. The names come from
 * `@/domain`; the day counts are local because only this file reads the matviews. A `Record` of
 * the domain's union, so adding a window there fails to compile here.
 */
export const PULSE_RIBBON_WINDOWS: Readonly<Record<PulseRibbonWindowName, number | null>> = {
  all: null,
  "1y": 365,
  "30d": 30,
};

/**
 * The payload shapes, from `@/domain`, re-exported so consumers keep one import. One home keeps the
 * adapter, the Next route and this builder agreeing about fields such as `unpaired`.
 */
export type { PulseRibbonWindow, PulseRibbonsPayload, PulseRibbonWindowName };

/** A pool's own name as a ribbon end, and the flag its accounting earns. */
const vpub = (...ends: PulseEnd[]): { vpubDerived?: true } =>
  ends.includes("sprout") ? { vpubDerived: true as const } : {};

interface BoundaryRow {
  day: string;
  pool: string;
  shielded_zat: string;
  shielded_txs: string;
  unshielded_zat: string;
  unshielded_txs: string;
  coinbase_zat: string;
  coinbase_txs: string;
  hub_zat: string;
  hub_txs: string;
}

interface MigrationRow {
  destination: string;
  source: string;
  txs: string;
  zat: string;
}

interface CloseRow {
  day: string;
  top_height: number;
  hash: string;
  prev_hash: string;
  timestamp: string;
  received_at: string | null;
  transparent_pool_zat: string | null;
  sprout_pool_zat: string | null;
  sapling_pool_zat: string | null;
  orchard_pool_zat: string | null;
  ironwood_pool_zat: string | null;
  lockbox_pool_zat: string | null;
}

const num = (v: string | null): number => Number(v);
const poolOrNull = (v: string | null): number | null => (v === null ? null : Number(v));
const isPool = (name: string): name is PoolName => (POOL_NAMES as readonly string[]).includes(name);

/** A close row as the domain's `PulseBlockPools`, nulls intact. */
function toClose(r: CloseRow): PulseBlockPools {
  return {
    height: r.top_height,
    hash: r.hash,
    prevHash: r.prev_hash,
    timestamp: num(r.timestamp),
    receivedAt: r.received_at === null ? null : num(r.received_at),
    pools: {
      transparent: poolOrNull(r.transparent_pool_zat),
      sprout: poolOrNull(r.sprout_pool_zat),
      sapling: poolOrNull(r.sapling_pool_zat),
      orchard: poolOrNull(r.orchard_pool_zat),
      ironwood: poolOrNull(r.ironwood_pool_zat),
      lockbox: poolOrNull(r.lockbox_pool_zat),
    },
  };
}

/**
 * The state before block 0: every pool at zero.
 *
 * Not a block, so it carries no hash. It lets the all-time mined edge go through the same
 * all-or-nothing rule as every other window (`issuanceZatBetween` refuses on any absent close).
 * That the pools held nothing before the chain existed is consensus; what it assumes is that the
 * index reaches genesis, or all-time issuance would be overstated.
 */
const GENESIS_CLOSE: PulseBlockPools = {
  height: -1,
  hash: "",
  prevHash: "",
  timestamp: 0,
  receivedAt: null,
  pools: {
    transparent: 0,
    sprout: 0,
    sapling: 0,
    orchard: 0,
    ironwood: 0,
    lockbox: 0,
  },
};

/**
 * The boundary ribbons: what crossed into each pool and what crossed out of it. A pool that
 * neither gained nor lost gets no edge rather than an edge at zero: nothing moved.
 */
export function boundaryEdges(rows: readonly BoundaryRow[]): PulseEdgeTotal[] {
  const totals = new Map<string, PulseEdgeTotal>();
  const add = (from: PulseEnd, to: PulseEnd, zat: number, events: number): void => {
    if (zat <= 0 && events <= 0) return;
    const key = `${from}>${to}`;
    const edge = totals.get(key) ?? { from, to, totalZat: 0, events: 0, ...vpub(from, to) };
    edge.totalZat += zat;
    edge.events += events;
    totals.set(key, edge);
  };
  for (const r of rows) {
    if (!isPool(r.pool)) continue; // the 'hub' row is `unpaired`, never a ribbon
    add("transparent", r.pool, num(r.shielded_zat), num(r.shielded_txs));
    add(r.pool, "transparent", num(r.unshielded_zat), num(r.unshielded_txs));
    add("mined", r.pool, num(r.coinbase_zat), num(r.coinbase_txs));
  }
  return [...totals.values()];
}

/**
 * The pool-to-pool ribbons, one per (source, destination). `source = 'multi'` is excluded and
 * reported as `unpaired`: the destination publishes one figure every source shares, and splitting
 * it is the apportioning `poolMigration` refuses.
 */
export function migrationEdges(rows: readonly MigrationRow[]): PulseEdgeTotal[] {
  const edges: PulseEdgeTotal[] = [];
  for (const r of rows) {
    if (r.source === "multi" || !isPool(r.source) || !isPool(r.destination)) continue;
    edges.push({
      from: r.source,
      to: r.destination,
      totalZat: num(r.zat),
      events: num(r.txs),
      ...vpub(r.source, r.destination),
    });
  }
  return edges;
}

/**
 * The cross-chain ribbons: one per (chain, direction, where it landed).
 *
 * Every one is a floor: public swap protocols only (custodial routes publish no per-transfer API,
 * and aggregators settle on the same venues, so counting them would double-count), and only
 * crossings the venue reported as completed. The Zcash end is `pulseZcashEnd`'s answer, shared
 * with the per-transfer pulses, so the two agree about where a crossing landed.
 */
export function crossChainEdges(rows: readonly CrossChainEdgeRow[]): PulseEdgeTotal[] {
  const totals = new Map<string, PulseEdgeTotal>();
  for (const r of rows) {
    if (r.zecAmountZat <= 0 && r.transfers <= 0) continue;
    const chain = pulseChainNode(r.chain);
    const zcash = pulseZcashEnd(r.addressKind);
    const [from, to]: [PulseEnd, PulseEnd] = r.direction === "in" ? [chain, zcash] : [zcash, chain];
    const key = `${from}>${to}`;
    const edge = totals.get(key) ?? {
      from,
      to,
      totalZat: 0,
      events: 0,
      floor: true as const,
    };
    edge.totalZat += r.zecAmountZat;
    edge.events += r.transfers;
    totals.set(key, edge);
  }
  return [...totals.values()];
}

/**
 * The issued edges: what the chain created over the window and where it put it.
 *
 * Measured from the six closes rather than coinbase outputs, which are subsidy plus collected fees
 * and would overstate issuance by the fees. Any absent close refuses the whole set
 * (`issuanceZatBetween`'s all-or-nothing rule).
 *
 * `mined → transparent` is what issuance did not put into the lockbox or a pool: the one figure
 * reached by subtraction, resting on the six pools partitioning every ZEC in existence. A negative
 * remainder means the closes should not have been differenced, and the edge is dropped.
 *
 * `events` counts the blocks the difference spans, since every block issues.
 */
export function minedEdges(
  prev: PulseBlockPools | null,
  cur: PulseBlockPools,
  coinbaseByPool: readonly PulseEdgeTotal[],
): PulseEdgeTotal[] {
  const issued = issuanceZatBetween(prev, cur);
  if (issued === null || prev === null) return [];
  const blocks = Math.max(0, cur.height - prev.height);

  const edges: PulseEdgeTotal[] = [];
  const beforeLockbox = prev.pools.lockbox;
  const afterLockbox = cur.pools.lockbox;
  const lockboxDelta =
    beforeLockbox === null || afterLockbox === null ? null : afterLockbox - beforeLockbox;
  if (lockboxDelta !== null && lockboxDelta > 0) {
    edges.push({ from: "mined", to: "lockbox", totalZat: lockboxDelta, events: blocks });
  }

  const intoPools = coinbaseByPool
    .filter((e) => e.from === "mined")
    .reduce((total, e) => total + e.totalZat, 0);
  const toTransparent = issued - (lockboxDelta ?? 0) - intoPools;
  if (lockboxDelta !== null && toTransparent > 0) {
    edges.push({ from: "mined", to: "transparent", totalZat: toTransparent, events: blocks });
  }
  return edges;
}

/**
 * Every ribbon for one window, read from the four sources.
 *
 * `fromDay` is a UTC date string (`YYYY-MM-DD`) or null for all of history: the day matviews' own
 * key, so a window starts at a midnight and ends at the instant it was read.
 */
async function windowRibbons(
  pool: Pool,
  edgeRows: readonly CrossChainEdgeRow[],
  fromDay: string | null,
  fromSeconds: number,
  asOf: number,
  closes: { first: PulseBlockPools | null; last: PulseBlockPools },
): Promise<PulseRibbonWindow> {
  const dayClause = fromDay === null ? "" : " WHERE day >= $1::date";
  const params = fromDay === null ? [] : [fromDay];

  const [boundary, migrations] = await Promise.all([
    pool.query<BoundaryRow>(
      `SELECT '' AS day, pool,
              SUM(shielded_zat)::text   AS shielded_zat,   SUM(shielded_txs)::text   AS shielded_txs,
              SUM(unshielded_zat)::text AS unshielded_zat, SUM(unshielded_txs)::text AS unshielded_txs,
              SUM(coinbase_zat)::text   AS coinbase_zat,   SUM(coinbase_txs)::text   AS coinbase_txs,
              SUM(hub_zat)::text        AS hub_zat,        SUM(hub_txs)::text        AS hub_txs
         FROM chain_day_pool_boundary${dayClause}
        GROUP BY pool`,
      params,
    ),
    pool.query<MigrationRow>(
      `SELECT destination, source, SUM(txs)::text AS txs, SUM(zat)::text AS zat
         FROM chain_day_pool_migration${dayClause}
        GROUP BY destination, source`,
      params,
    ),
  ]);

  const boundaryTotals = boundaryEdges(boundary.rows);
  const coinbase = boundaryTotals.filter((e) => e.from === "mined");
  const hub = boundary.rows.find((r) => r.pool === "hub");
  const multi = migrations.rows.filter((r) => r.source === "multi");

  return {
    window: { fromSeconds, toSeconds: asOf },
    edges: [
      ...minedEdges(closes.first, closes.last, coinbase),
      ...boundaryTotals,
      ...migrationEdges(migrations.rows),
      ...crossChainEdges(edgeRows),
    ],
    unpaired: {
      hubZat: hub === undefined ? 0 : num(hub.hub_zat),
      hubTxs: hub === undefined ? 0 : num(hub.hub_txs),
      multiMigrationZat: multi.reduce((total, r) => total + num(r.zat), 0),
      multiMigrationTxs: multi.reduce((total, r) => total + num(r.txs), 0),
    },
  };
}

/** `YYYY-MM-DD` for a UTC day `daysAgo` days back, which is the matviews' own key. */
function utcDayString(daysAgo: number, now: number): string {
  return utcDayFromMs(now - daysAgo * DAY_MS);
}

/** Midnight UTC at the start of that day, unix seconds. */
function utcDayStart(day: string): number {
  return Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000);
}

/**
 * Every window's ribbons, or null when the views this rests on have not been populated. Never an
 * empty set: `edges: []` would state that nothing has ever crossed the boundary. The route turns
 * null into a 503.
 */
export async function loadPulseRibbons(
  pool: Pool,
  edges: {
    all: readonly CrossChainEdgeRow[];
    "1y": readonly CrossChainEdgeRow[];
    "30d": readonly CrossChainEdgeRow[];
  },
  now: number = Date.now(),
): Promise<PulseRibbonsPayload | null> {
  const populated = await pool.query<{ matviewname: string; ispopulated: boolean }>(
    `SELECT matviewname, ispopulated FROM pg_matviews
      WHERE matviewname IN ('chain_day_pool_boundary', 'chain_day_supply_close',
                            'chain_day_pool_migration')`,
  );
  if (populated.rows.length < 3 || populated.rows.some((r) => !r.ispopulated)) return null;

  const asOf = Math.floor(now / 1000);
  const closeColumns = `to_char(day, 'YYYY-MM-DD') AS day, top_height, hash, prev_hash,
          timestamp::text AS timestamp, received_at::text AS received_at,
          transparent_pool_zat::text AS transparent_pool_zat,
          sprout_pool_zat::text      AS sprout_pool_zat,
          sapling_pool_zat::text     AS sapling_pool_zat,
          orchard_pool_zat::text     AS orchard_pool_zat,
          ironwood_pool_zat::text    AS ironwood_pool_zat,
          lockbox_pool_zat::text     AS lockbox_pool_zat`;
  const latest = await pool.query<CloseRow>(
    `SELECT ${closeColumns} FROM chain_day_supply_close ORDER BY day DESC LIMIT 1`,
  );
  const last = latest.rows[0];
  if (last === undefined) return null;
  const lastClose = toClose(last);

  const windows = {} as Record<PulseRibbonWindowName, PulseRibbonWindow>;
  for (const [name, days] of Object.entries(PULSE_RIBBON_WINDOWS) as [
    PulseRibbonWindowName,
    number | null,
  ][]) {
    // The window's first day, and the close of the day before it: the baseline every mined edge is
    // differenced from. All-time differences from the state before block 0.
    const fromDay = days === null ? null : utcDayString(days - 1, now);
    let first: PulseBlockPools | null = GENESIS_CLOSE;
    let fromSeconds = 0;
    if (fromDay !== null) {
      fromSeconds = utcDayStart(fromDay);
      const before = await pool.query<CloseRow>(
        `SELECT ${closeColumns} FROM chain_day_supply_close
          WHERE day < $1::date ORDER BY day DESC LIMIT 1`,
        [fromDay],
      );
      // No row before the window means the index does not reach back that far, so there is
      // nothing to difference against and the mined edges are simply absent for it.
      first = before.rows[0] === undefined ? null : toClose(before.rows[0]);
    } else {
      const earliest = await pool.query<{ day: string }>(
        `SELECT to_char(min(day), 'YYYY-MM-DD') AS day FROM chain_day_supply_close`,
      );
      const day = earliest.rows[0]?.day;
      fromSeconds = day ? utcDayStart(day) : 0;
    }
    windows[name] = await windowRibbons(pool, edges[name], fromDay, fromSeconds, asOf, {
      first,
      last: lastClose,
    });
  }

  return { asOf, height: lastClose.height, windows };
}
