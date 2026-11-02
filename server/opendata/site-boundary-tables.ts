import type { Findings } from "./checks";
import { checkFresh, checkUtcMidnights, compareRows, daysOf, HEX64, upTo } from "./site-checks";
import type { SiteInputs } from "./site-series";
import type { SiteViews } from "./site-views";
import type { SiteTable } from "./tables";

/**
 * The tables read from the site's views (pool boundary, shielding flow, pool migration, monthly
 * fees, and the daily shielding records), each held to the same figures recomputed from the
 * export's transaction stream, so a view that is stale or wrong cannot be published.
 */

type Row = Record<string, unknown>;

const LEG_COLUMNS = [
  "shielded_zat",
  "shielded_txs",
  "unshielded_zat",
  "unshielded_txs",
  "coinbase_zat",
  "coinbase_txs",
  "hub_zat",
  "hub_txs",
];
const COUNT_COLUMNS = ["shielding_txs", "unshielding_txs", "indeterminate_txs", "migration_txs"];
const MAXIMA = ["shielding", "unshielding", "migration"] as const;
const RECORD_COLUMNS = MAXIMA.flatMap((k) => [`max_${k}_zat`, `max_${k}_ties`, `max_${k}_txid`]);

const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const monthOf = (day: string) => `${day.slice(0, 7)}-01`;

/** The last day of the UTC month that starts on `month`. */
function monthEnd(month: string): string {
  const d = new Date(`${month}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
}

function poolBoundary(f: Findings, v: SiteViews, x: SiteInputs): Row[] {
  if (!v.pool_boundary_daily) return [];
  checkFresh(f, "chain_day_pool_boundary", daysOf(v.pool_boundary_daily), x.finalDay);
  const rows = upTo(v.pool_boundary_daily, x.finalDay);
  compareRows(
    f,
    {
      name: "pool_boundary_daily",
      against: "the stream",
      key: ["day", "pool"],
      columns: LEG_COLUMNS,
    },
    rows,
    x.stream.boundary.boundaryRows(x.finalDay),
  );
  return rows;
}

function shieldingFlow(f: Findings, v: SiteViews, x: SiteInputs): Row[] {
  if (!v.shielding_flow_daily) return [];
  checkFresh(f, "chain_day_shielding_flow", daysOf(v.shielding_flow_daily), x.finalDay);
  checkUtcMidnights(
    f,
    "chain_day_shielding_flow",
    v.shielding_flow_daily.map((r) => r.ts),
  );
  const rows = upTo(v.shielding_flow_daily, x.finalDay);
  compareRows(
    f,
    {
      name: "shielding_flow_daily",
      against: "the stream",
      key: ["day"],
      columns: ["shielded_zat", "unshielded_zat"],
    },
    rows,
    x.stream.boundary.flowRows(x.finalDay),
  );
  return rows;
}

/**
 * A quiet day has no migration row, so this view's staleness is judged by its counts alone: each
 * day's transactions must equal `boundary_daily.migration_txs`, which is itself held to the stream.
 */
function poolMigration(f: Findings, v: SiteViews, x: SiteInputs): Row[] {
  if (!v.pool_migration_daily) return [];
  const rows = upTo(v.pool_migration_daily, x.finalDay);
  const perDay = new Map<string, bigint>();
  for (const r of rows) {
    const day = String(r.day);
    perDay.set(day, (perDay.get(day) ?? 0n) + BigInt(r.txs as number));
  }
  compareRows(
    f,
    {
      name: "pool_migration_daily",
      against: "boundary_daily",
      key: ["day"],
      columns: ["migration_txs"],
    },
    [...perDay].map(([day, n]) => ({ day, migration_txs: n })),
    upTo(v.shielding_daily, x.finalDay)
      .filter((r) => BigInt(r.migration_txs as bigint) > 0n)
      .map((r) => ({ day: r.day, migration_txs: r.migration_txs })),
  );
  compareRows(
    f,
    {
      name: "pool_migration_daily",
      against: "the stream",
      key: ["day", "destination", "source"],
      columns: ["txs", "zat"],
    },
    rows,
    x.stream.boundary.migrationRows(x.finalDay),
  );
  return rows;
}

/**
 * Complete months only. Month-keyed, so current when it has a row for the month holding the day
 * after the final day; each month's counts must equal the stream's.
 */
function feesMonthly(f: Findings, v: SiteViews, x: SiteInputs): Row[] {
  if (!v.fees_monthly) return [];
  const next = monthOf(addDays(x.finalDay, 1));
  if (!v.fees_monthly.some((r) => r.month === next)) {
    f.add("stale view: no row for the month after the final day", "chain_month_fee_kind");
  }
  checkUtcMidnights(
    f,
    "chain_month_fee_kind",
    v.fees_monthly.map((r) => r.ts),
  );
  const rows = v.fees_monthly.filter((r) => monthEnd(String(r.month)) <= x.finalDay);
  const complete = (m: string) => monthEnd(m) <= x.finalDay;
  compareRows(
    f,
    { name: "fees_monthly", against: "the stream", key: ["month", "kind"], columns: ["txs"] },
    rows,
    x.stream.feeTxRows().filter((r) => complete(r.month)),
  );
  return rows;
}

/**
 * `boundary_daily`'s maxima. A txid is published only for a unique maximum (the view nulls the
 * others) and must be a transaction id; the whole row, counts included, must equal the stream's.
 */
function shieldingRecords(f: Findings, v: SiteViews, x: SiteInputs): Row[] {
  if (!v.shielding_records_daily) return [];
  checkFresh(f, "boundary_daily", daysOf(v.shielding_records_daily), x.finalDay);
  const rows = upTo(v.shielding_records_daily, x.finalDay);
  for (const r of rows) {
    for (const k of MAXIMA) {
      const zat = r[`max_${k}_zat`];
      const ties = r[`max_${k}_ties`];
      const txid = r[`max_${k}_txid`];
      if ((zat === null) !== (ties === 0))
        f.add(`max_${k}: amount and ties disagree`, String(r.day));
      if (txid !== null && (typeof txid !== "string" || !HEX64.test(txid))) {
        f.add(`max_${k}_txid: not a transaction id`, String(r.day));
      }
      if (ties === 1 && txid === null)
        f.add(`max_${k}: a unique maximum without its txid`, String(r.day));
    }
  }
  const counts = new Map(upTo(v.shielding_daily, x.finalDay).map((r) => [String(r.day), r]));
  compareRows(
    f,
    {
      name: "shielding_records_daily",
      against: "the stream",
      key: ["day"],
      columns: [...COUNT_COLUMNS, ...RECORD_COLUMNS],
    },
    rows.map((r) => ({ ...counts.get(String(r.day)), ...r })),
    x.stream.boundary.recordRows(x.finalDay, x.stream.days()),
  );
  return rows;
}

export function boundaryTables(f: Findings, v: SiteViews, x: SiteInputs): [SiteTable, Row[]][] {
  return [
    ["pool_boundary_daily", poolBoundary(f, v, x)],
    ["shielding_flow_daily", shieldingFlow(f, v, x)],
    ["pool_migration_daily", poolMigration(f, v, x)],
    ["fees_monthly", feesMonthly(f, v, x)],
    ["shielding_records_daily", shieldingRecords(f, v, x)],
  ];
}
