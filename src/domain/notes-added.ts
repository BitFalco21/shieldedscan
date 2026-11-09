import type { NoteTreeDayPoint } from "./chart-series";
import { DAY_SECONDS } from "./time";

/**
 * Notes each pool's commitment tree gained in a period: the difference of two closes, exact
 * because the tree only grows. `/v1/analytics/pool-usage` publishes the same figure as
 * `notes.created`, and it equals the pool's own bundle count over the period: one note per Sapling
 * output and per Orchard or Ironwood action.
 *
 * Pools are never added: a spend hides only among its own pool's notes.
 */
export interface NotesAddedPoint {
  /** Unix seconds at the start of the UTC day or month. */
  timestamp: number;
  sapling: number | null;
  orchard: number | null;
  ironwood: number | null;
}

const POOLS = ["sapling", "orchard", "ironwood"] as const;
type TreePool = (typeof POOLS)[number];
const tree = (p: NoteTreeDayPoint, pool: TreePool) =>
  pool === "sapling" ? p.saplingNotes : pool === "orchard" ? p.orchardNotes : p.ironwoodNotes;

/**
 * One day's growth for a pool, or null where it cannot be stated: no close that day, no day
 * before it in the series, a day missing in between (the difference would span two days), or a
 * null close the day before once the pool has had one (a missing close, not an empty tree). Only
 * the pool's FIRST close in the series, after a day it had none, is growth from empty: the
 * `firstTree` rule `/v1/analytics/pool-usage` applies. A series that opens on a pool already
 * holding notes has no base for its first day.
 */
function dayGrowth(
  points: readonly NoteTreeDayPoint[],
  i: number,
  pool: TreePool,
  first: number,
): number | null {
  const cur = tree(points[i]!, pool);
  const prev = points[i - 1];
  if (cur === null || prev === undefined) return null;
  if (points[i]!.timestamp - prev.timestamp !== DAY_SECONDS) return null;
  const before = tree(prev, pool);
  if (before !== null) return cur - before;
  return i === first ? cur : null;
}

/** The index of each pool's first close in the series; -1 for a pool with none. */
const firstClose = (points: readonly NoteTreeDayPoint[], pool: TreePool) =>
  points.findIndex((p) => tree(p, pool) !== null);

const monthStart = (ts: number) => {
  const d = new Date(ts * 1000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth()) / 1000;
};

/**
 * Notes added per UTC day, or per UTC month (the sum of its days). A month is null for a pool
 * once any of its days after the pool's first close cannot be stated: a sum over part of a month
 * would read as a quiet month. Before a pool's first close it is null, never zero.
 */
export function notesAdded(
  points: readonly NoteTreeDayPoint[],
  grain: "day" | "month",
): NotesAddedPoint[] {
  const first = {
    sapling: firstClose(points, "sapling"),
    orchard: firstClose(points, "orchard"),
    ironwood: firstClose(points, "ironwood"),
  };
  const days = points.map((p, i) => ({
    timestamp: p.timestamp,
    sapling: dayGrowth(points, i, "sapling", first.sapling),
    orchard: dayGrowth(points, i, "orchard", first.orchard),
    ironwood: dayGrowth(points, i, "ironwood", first.ironwood),
  }));
  if (grain === "day") return days;
  const months = new Map<number, NotesAddedPoint>();
  const poisoned = new Set<string>();
  const started = new Set<TreePool>();
  days.forEach((d, i) => {
    const key = monthStart(d.timestamp);
    const m = months.get(key) ?? { timestamp: key, sapling: null, orchard: null, ironwood: null };
    for (const pool of POOLS) {
      const v = d[pool];
      if (tree(points[i]!, pool) !== null) started.add(pool);
      if (v === null) {
        // Once the pool exists, a day whose growth is unknown leaves the whole month unknown.
        if (started.has(pool)) poisoned.add(`${key}:${pool}`);
        continue;
      }
      m[pool] = (m[pool] ?? 0) + v;
    }
    months.set(key, m);
  });
  return [...months.values()].map((m) => {
    const out = { ...m };
    for (const pool of POOLS) if (poisoned.has(`${m.timestamp}:${pool}`)) out[pool] = null;
    return out;
  });
}
