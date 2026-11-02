import { byCodePoint, utcDay } from "./checks";
import type { MetricTx } from "./metrics";

/**
 * The site's boundary series recomputed from the export's transaction stream, as cross-checks
 * only: `boundary_daily` (`BOUNDARY_DAY_SQL`), `chain_day_pool_migration`,
 * `chain_day_shielding_flow` and `chain_day_pool_boundary`, each mirrored from its SQL in
 * `server/schema-chain.sql` / `server/boundary-daily.ts`. The published rows come from the site's
 * views; these say whether those views are complete and current at the release height.
 *
 * Signs as in that SQL: bundle balances are in domain sign (positive = entering the pool) and
 * Sprout's `vpub_net` is negated into it. A missing balance counts as zero, as COALESCE does there.
 */

export interface BoundaryTx extends MetricTx {
  txid: string;
  direction: string | null;
  fee_zat: bigint | null;
}

interface Max {
  zat: bigint | null;
  ties: number;
  txid: string | null;
}

interface DayRecords {
  shielding_txs: number;
  unshielding_txs: number;
  indeterminate_txs: number;
  migration_txs: number;
  shielding: Max;
  unshielding: Max;
  migration: Max;
}

interface Legs {
  shielded_zat: bigint;
  shielded_txs: number;
  unshielded_zat: bigint;
  unshielded_txs: number;
  coinbase_zat: bigint;
  coinbase_txs: number;
  hub_zat: bigint;
  hub_txs: number;
}

const abs = (v: bigint) => (v < 0n ? -v : v);
const emptyMax = (): Max => ({ zat: null, ties: 0, txid: null });
const emptyRecords = (): DayRecords => ({
  shielding_txs: 0,
  unshielding_txs: 0,
  indeterminate_txs: 0,
  migration_txs: 0,
  shielding: emptyMax(),
  unshielding: emptyMax(),
  migration: emptyMax(),
});
const emptyLegs = (): Legs => ({
  shielded_zat: 0n,
  shielded_txs: 0,
  unshielded_zat: 0n,
  unshielded_txs: 0,
  coinbase_zat: 0n,
  coinbase_txs: 0,
  hub_zat: 0n,
  hub_txs: 0,
});

/** Keeps the largest amount, how many share it, and the smallest txid among them. */
function offer(m: Max, zat: bigint, txid: string): void {
  if (m.zat === null || zat > m.zat) {
    m.zat = zat;
    m.ties = 1;
    m.txid = txid;
  } else if (zat === m.zat) {
    m.ties++;
    if (byCodePoint(txid, m.txid!) < 0) m.txid = txid;
  }
}

function getOr<K, V>(map: Map<K, V>, key: K, make: () => V): V {
  let v = map.get(key);
  if (v === undefined) {
    v = make();
    map.set(key, v);
  }
  return v;
}

export class DailyBoundary {
  private readonly records = new Map<string, DayRecords>();
  private readonly migrations = new Map<string, { txs: number; zat: bigint }>();
  private readonly flows = new Map<string, { shielded: bigint; unshielded: bigint }>();
  private readonly legs = new Map<string, Legs>();

  /** `day` is the transaction's UTC day, passed in when the caller has already computed it. */
  push(tx: BoundaryTx, day = utcDay(tx.timestamp)): void {
    const iw = tx.ironwood_value_balance_zat ?? 0n;
    const oc = tx.orchard_value_balance_zat ?? 0n;
    const sa = tx.sapling_value_balance_zat ?? 0n;
    const sr = -(tx.sprout_vpub_net_zat ?? 0n);
    const net = iw + oc + sa + sr;

    if (tx.kind === "mixed" || tx.kind === "shielded") {
      const r = getOr(this.records, day, emptyRecords);
      if (tx.kind === "mixed" && tx.direction === "shielding") {
        r.shielding_txs++;
        offer(r.shielding, net, tx.txid);
      } else if (tx.kind === "mixed" && tx.direction === "unshielding") {
        r.unshielding_txs++;
        offer(r.unshielding, -net, tx.txid);
      } else if (tx.kind === "mixed" && tx.direction === "indeterminate") {
        r.indeterminate_txs++;
      }
      if (tx.kind === "shielded") this.migration(day, tx.txid, r, [iw, oc, sa, sr]);
    }

    if (tx.kind !== "coinbase") {
      const f = getOr(this.flows, day, () => ({ shielded: 0n, unshielded: 0n }));
      if (net > 0n) f.shielded += net;
      else f.unshielded -= net;
    }

    if (tx.kind === "mixed" || tx.kind === "coinbase") this.boundaryLegs(day, tx, iw, oc, sa, sr);
  }

  /** One pool gaining (the destination, its balance the amount), at least one losing. */
  private migration(day: string, txid: string, r: DayRecords, bal: bigint[]): void {
    const names = ["ironwood", "orchard", "sapling", "sprout"];
    const gaining = bal.filter((b) => b > 0n).length;
    const losing = bal.filter((b) => b < 0n).length;
    if (gaining !== 1 || losing < 1) return;
    const d = bal.findIndex((b) => b > 0n);
    const source = losing > 1 ? "multi" : names[bal.findIndex((b) => b < 0n)]!;
    r.migration_txs++;
    offer(r.migration, bal[d]!, txid);
    const m = getOr(this.migrations, `${day} ${names[d]} ${source}`, () => ({ txs: 0, zat: 0n }));
    m.txs++;
    m.zat += bal[d]!;
  }

  /**
   * `chain_day_pool_boundary`: a coinbase's legs are issuance; a mixed transaction follows its
   * direction while no published pool (Sprout excepted) moved the other way, and is otherwise a
   * hub row, counted once per transaction rather than per pool.
   */
  private boundaryLegs(
    day: string,
    tx: BoundaryTx,
    iw: bigint,
    oc: bigint,
    sa: bigint,
    sr: bigint,
  ): void {
    let bucket: "coinbase" | "shielded" | "unshielded" | "hub" = "hub";
    if (tx.kind === "coinbase") bucket = "coinbase";
    else if (tx.direction === "shielding" && !(iw < 0n || oc < 0n || sa < 0n)) bucket = "shielded";
    else if (tx.direction === "unshielding" && !(iw > 0n || oc > 0n || sa > 0n))
      bucket = "unshielded";

    const pools: [string, bigint, boolean][] = [
      ["sprout", sr, tx.sprout_joinsplits !== null],
      ["sapling", sa, tx.sapling_spends !== null],
      ["orchard", oc, tx.orchard_actions !== null],
      ["ironwood", iw, tx.ironwood_actions !== null],
    ];
    for (const [pool, bal, present] of pools) {
      if (!present || bal === 0n) continue;
      const l = getOr(this.legs, `${day} ${pool}`, emptyLegs);
      if (bucket === "hub") continue;
      l[`${bucket}_zat`] += abs(bal);
      l[`${bucket}_txs`]++;
    }
    if (bucket === "hub") {
      const h = getOr(this.legs, `${day} hub`, emptyLegs);
      h.hub_zat += abs(iw) + abs(oc) + abs(sa) + abs(sr);
      h.hub_txs++;
    }
  }

  /**
   * `boundary_daily`'s counts and maxima for each of `days` (every day with a block, since the
   * tracker writes a row for a day with no crossing too); a txid only where the maximum is unique.
   */
  recordRows(finalDay: string, days: Iterable<string>): Record<string, unknown>[] {
    return [...days]
      .filter((day) => day <= finalDay)
      .sort(byCodePoint)
      .map((day) => {
        const r = this.records.get(day) ?? emptyRecords();
        const max = (k: "shielding" | "unshielding" | "migration") => ({
          [`max_${k}_zat`]: r[k].zat,
          [`max_${k}_ties`]: r[k].ties,
          [`max_${k}_txid`]: r[k].ties === 1 ? r[k].txid : null,
        });
        return {
          day,
          shielding_txs: r.shielding_txs,
          unshielding_txs: r.unshielding_txs,
          indeterminate_txs: r.indeterminate_txs,
          migration_txs: r.migration_txs,
          ...max("shielding"),
          ...max("unshielding"),
          ...max("migration"),
        };
      });
  }

  migrationRows(finalDay: string): Record<string, unknown>[] {
    return [...this.migrations]
      .map(([key, m]) => {
        const [day, destination, source] = key.split(" ") as [string, string, string];
        return { day, destination, source, txs: m.txs, zat: m.zat };
      })
      .filter((r) => r.day <= finalDay);
  }

  flowRows(finalDay: string): Record<string, unknown>[] {
    return [...this.flows]
      .map(([day, f]) => ({ day, shielded_zat: f.shielded, unshielded_zat: f.unshielded }))
      .filter((r) => r.day <= finalDay);
  }

  boundaryRows(finalDay: string): Record<string, unknown>[] {
    return [...this.legs]
      .map(([key, l]) => {
        const [day, pool] = key.split(" ") as [string, string];
        return { day, pool, ...l };
      })
      .filter((r) => r.day <= finalDay);
  }
}
