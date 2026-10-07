import { Hono } from "hono";
import type { Pool } from "pg";
import { Cached } from "../cached";
import "../pg-types";
import { DAY_SECONDS, utcDayFromSeconds } from "@/domain/time";
import { MAINNET_SITE_URL as SITE } from "@/lib/network";
import { amount } from "./format";
import { rejectUnknown } from "./params";
import { chainDayExtent } from "../pool-usage";
import {
  loadTransparentSeries,
  monthOf,
  nextMonth,
  type TransparentDayRow,
  type TransparentSeries,
} from "../transparent-daily";
import { parseSeriesWindow } from "./analytics-series";
import { routeGroupErrors, setCache } from "./http";
import { SHAPE_PARAMS, applyShape, parseShape } from "./series-shape";

/**
 * `/v1/analytics/transparent`: transparent volume and active addresses per day or month, from
 * the tables `TransparentTracker` keeps. Pure, so the arithmetic (above all which address counts
 * may be stated for which span) is tested without a database.
 *
 * Volume is a flow, so it sums over any window. A distinct address count is not: an address
 * active on two days is one address in their month, so a count is stated only for a span it was
 * counted over exactly (one day, one whole calendar month, one of the trailing windows) and is
 * absent, with its reason, everywhere else. A month cut by the window gets none rather than its
 * whole-month count, which would describe days the window excludes.
 */

export const V1_TRANSPARENT_PATH = "/v1/analytics/transparent";

export interface TransparentWindow {
  from: string | null;
  to: string | null;
  interval: "day" | "month";
  fromTs: number;
  toTs: number;
}

/** The volume of a set of days: counts and values sum, being flows. */
function volume(days: readonly TransparentDayRow[]) {
  const s = {
    outputs: 0,
    unaddressed: 0,
    outT: 0,
    outM: 0,
    inputs: 0,
    unresolved: 0,
    inT: 0,
    inM: 0,
  };
  for (const d of days) {
    s.outputs += d.outputs;
    s.unaddressed += d.unaddressedOutputs;
    s.outT += d.outTransparentZat;
    s.outM += d.outMixedZat;
    s.inputs += d.inputs;
    s.unresolved += d.unresolvedInputs;
    s.inT += d.inTransparentZat;
    s.inM += d.inMixedZat;
  }
  return {
    outputs: {
      count: s.outputs,
      unaddressed: s.unaddressed,
      value: {
        transparent: amount(s.outT),
        mixed: amount(s.outM),
        total: amount(s.outT + s.outM),
      },
    },
    inputs: {
      count: s.inputs,
      unresolved: s.unresolved,
      value: { transparent: amount(s.inT), mixed: amount(s.inM), total: amount(s.inT + s.inM) },
    },
  };
}

const addressesOf = (r: { active: number; sending: number; receiving: number }) => ({
  active: r.active,
  sending: r.sending,
  receiving: r.receiving,
});

const TRANSPARENT_BASIS =
  "every transparent input and output this explorer indexes, per UTC day by block time. `outputs.value` is the ZEC the period's non-coinbase transactions paid to transparent outputs, split by the transaction's kind: `transparent` (no shielded side) and `mixed` (crossing the shielded boundary). It includes change returned to the sender — which output paid whom is not recorded on the chain — so it bounds the value that changed hands from above and is not ZEC sent. `inputs.value` is the ZEC transparent inputs spent. Coinbase outputs are issuance and fees (see the miners endpoint), not volume. `addresses` counts distinct transparent addresses that sent (an input) or received (an output, coinbase included), exactly, over a whole UTC day, a whole calendar month, or the trailing 7, 30 and 90 complete days. A distinct count does not add across periods, so it is stated only for a span it was counted over: a total carries one only when the window is exactly one of those spans. An output naming no single address (a bare key, multisig, OP_RETURN) is volume and no address. Shielded activity has no address and is in no figure here.";

export function buildTransparent(
  series: TransparentSeries,
  w: TransparentWindow,
  nowSec: number,
  chainFirstDay: number | null,
) {
  const unknowns: Record<string, string> = {};
  const kept = series.days.filter((d) => d.day >= w.fromTs && d.day < w.toTs);
  const months = new Map(series.months.map((m) => [m.month, m]));
  const computedPerMonth = new Map<number, number>();
  for (const d of series.days) {
    const m = monthOf(d.day);
    computedPerMonth.set(m, (computedPerMonth.get(m) ?? 0) + 1);
  }
  /**
   * A month's count, for a point covering `daysInPoint` of its days — or null. Stated only when
   * the count covers exactly the days the point does and every day computed in the month: a month
   * whose newest days arrived after it was counted is not stated until it is counted again.
   */
  const monthAddresses = (start: number, daysInPoint: number) => {
    const m = months.get(start);
    if (!m || m.days !== daysInPoint || m.days !== computedPerMonth.get(start)) return null;
    return addressesOf(m);
  };
  const cutsMonth = (start: number) => w.fromTs > start || w.toTs < nextMonth(start);

  const periodOf = (ts: number) => (w.interval === "month" ? monthOf(ts) : ts);
  const periods = [...new Set(kept.map((d) => periodOf(d.day)))].sort((a, b) => a - b);
  let uncounted = 0;
  const points = periods.map((start, i) => {
    const days = kept.filter((d) => periodOf(d.day) === start);
    let addresses: ReturnType<typeof addressesOf> | null;
    if (w.interval === "day") {
      addresses = addressesOf(days[0]!);
    } else {
      addresses = monthAddresses(start, days.length);
      if (addresses === null) {
        if (cutsMonth(start)) {
          unknowns[`data.points.${i}.addresses`] = "omitted";
        } else {
          unknowns[`data.points.${i}.addresses`] = "unmeasured";
          uncounted += 1;
        }
      }
    }
    return { periodStart: utcDayFromSeconds(start), days: days.length, ...volume(days), addresses };
  });

  // A total's distinct count, only when the window IS a span counted exactly.
  const totalAddresses = (() => {
    const only = kept.length === 1 ? kept[0]! : null;
    if (only && w.fromTs === only.day && w.toTs === only.day + DAY_SECONDS) {
      return addressesOf(only);
    }
    const m = monthOf(w.fromTs);
    if (w.fromTs === m && w.toTs === nextMonth(m)) {
      const counted = monthAddresses(m, kept.length);
      if (counted) return counted;
    }
    for (const t of series.trailing) {
      if (
        w.fromTs === t.lastDay - (t.days - 1) * DAY_SECONDS &&
        w.toTs === t.lastDay + DAY_SECONDS
      ) {
        return addressesOf(t);
      }
    }
    return null;
  })();
  if (totalAddresses === null) unknowns["data.totals.addresses"] = "omitted";

  const notes: string[] = [];
  const todayStart = Math.floor(nowSec / DAY_SECONDS) * DAY_SECONDS;
  if (w.toTs > todayStart) {
    notes.push("The window includes today's unfinished UTC day; its figures cover the day so far.");
  }
  const firstDay = chainFirstDay ?? series.days[0]?.day ?? null;
  if (firstDay === null) {
    notes.push("Nothing is computed yet.");
  } else {
    const stored = new Set(series.days.map((d) => d.day));
    const lo = Math.max(w.fromTs, firstDay);
    const hi = Math.min(w.toTs, todayStart + DAY_SECONDS);
    let missing = 0;
    for (let d = lo; d < hi; d += DAY_SECONDS) if (!stored.has(d)) missing += 1;
    if (missing > 0) notes.push(`${missing} day(s) in this window are not computed yet.`);
  }
  if (uncounted > 0) {
    notes.push(`${uncounted} month(s) in this window have no address count yet.`);
  }
  const unresolved = kept.reduce((s, d) => s + d.unresolvedInputs, 0);
  if (unresolved > 0) {
    notes.push(
      `${unresolved} transparent input(s) in this window have no resolved value, so inputs.value is a floor.`,
    );
  }

  return {
    coverage: { status: notes.length === 0 ? ("complete" as const) : ("partial" as const), notes },
    data: {
      interval: w.interval,
      totals: { days: kept.length, ...volume(kept), addresses: totalAddresses },
      points,
      // Whatever the window: "the last 30 days" is the question these answer.
      trailing: series.trailing.map((t) => ({
        days: t.days,
        from: utcDayFromSeconds(t.lastDay - (t.days - 1) * DAY_SECONDS),
        through: utcDayFromSeconds(t.lastDay),
        addresses: addressesOf(t),
      })),
    },
    unknowns,
  };
}

// ------------------------------------------------------------------------------- route

const MEMO_MS = 10 * 60 * 1000;
/**
 * After the memo expires, the old series is served for up to this long while the reload runs
 * behind it, so no caller waits on the reload's cold query. The source tables change hourly at
 * most, and every answer carries its own coverage line, so a slightly older copy states nothing
 * false.
 */
const STALE_MS = 30 * 60 * 1000;

interface Loaded {
  series: TransparentSeries;
  chainFirstDay: number | null;
}

export interface V1TransparentDeps {
  pool: Pool;
  now?: () => number;
  /** Injectable so the HTTP contract is testable without a database. */
  load?: () => Promise<Loaded>;
}

/**
 * The route, as one of the published daily series: the whole table (a row a day since 2016, a row
 * a month) is loaded into a ten-minute memo and every window is cut in memory, so any request costs
 * the same one read and it rides `/v1`'s ordinary limits. The tracker refreshes the tables every
 * ten minutes too.
 */
export function v1TransparentRoutes(deps: V1TransparentDeps): Hono {
  const app = new Hono();
  const now = deps.now ?? Date.now;
  const nowSec = () => Math.floor(now() / 1000);
  const load =
    deps.load ??
    (async (): Promise<Loaded> => {
      const [series, extent] = await Promise.all([
        loadTransparentSeries(deps.pool),
        chainDayExtent(deps.pool, nowSec()),
      ]);
      return { series, chainFirstDay: extent?.first ?? null };
    });
  const memo = new Cached<Loaded>(MEMO_MS, { staleMs: STALE_MS });

  app.onError(routeGroupErrors("the chain index could not answer just now; retry shortly"));

  app.get(V1_TRANSPARENT_PATH, async (c) => {
    const q = c.req.query();
    rejectUnknown(q, ["from", "to", "interval", ...SHAPE_PARAMS]);
    const shape = parseShape(q);
    const w = parseSeriesWindow(q);
    const loaded = await memo.get(load);
    const built = buildTransparent(loaded.series, w, nowSec(), loaded.chainFirstDay);
    setCache(c, "series");
    return c.json(
      applyShape(
        {
          query: { from: w.from, to: w.to, interval: w.interval },
          coverage: built.coverage,
          source: { name: "ShieldedScan", url: `${SITE}/api-docs#analytics-transparent` },
          basis: TRANSPARENT_BASIS,
          data: built.data,
          unknowns: built.unknowns,
          asOf: nowSec(),
        },
        shape,
      ),
    );
  });

  return app;
}
