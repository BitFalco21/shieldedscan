import { blockSubsidyZat } from "@/domain/halving";
import { nu7ActiveAt } from "@/domain/consensus";
import { SOLUTIONS_PER_DIFFICULTY } from "@/domain/mining";
import { utcDay, type BlockRow } from "./checks";

/**
 * Daily series derived from the block and transaction streams the export already reads, so they
 * cost the database nothing. Each class takes rows in height order and returns the days up to
 * the release's final day, in a fixed order.
 */

/** The transaction fields the stream metrics read. Bundle balances are in domain sign. */
export interface MetricTx {
  timestamp: bigint;
  kind: string;
  version: number;
  sprout_vpub_net_zat: bigint | null;
  sapling_value_balance_zat: bigint | null;
  orchard_value_balance_zat: bigint | null;
  ironwood_value_balance_zat: bigint | null;
}

const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Transactions per UTC day by format version: v4 ends at NU7 (ZIP 2003). */
export class DailyTxVersions {
  private readonly counts = new Map<string, number>();

  push(tx: MetricTx): void {
    const key = `${utcDay(tx.timestamp)} ${tx.version}`;
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
  }

  rows(finalDay: string): Record<string, unknown>[] {
    return [...this.counts]
      .map(([key, txs]) => {
        const [day, version] = key.split(" ") as [string, string];
        return { day, version: Number(version), txs };
      })
      .filter((r) => r.day <= finalDay)
      .sort((a, b) => byCodePoint(a.day, b.day) || a.version - b.version);
  }
}

/**
 * Each shielded pool's gross flows per UTC day: value in (positive balances) and out (negative),
 * never netted per transaction. Sprout's public value is stored in the node's sign (positive =
 * leaving), so it is negated into the domain sign the others use.
 */
export class DailyPoolFlows {
  private readonly days = new Map<string, { inflow: bigint; outflow: bigint; txs: number }>();

  push(tx: MetricTx): void {
    const day = utcDay(tx.timestamp);
    const balances: [string, bigint | null][] = [
      ["sprout", tx.sprout_vpub_net_zat === null ? null : -tx.sprout_vpub_net_zat],
      ["sapling", tx.sapling_value_balance_zat],
      ["orchard", tx.orchard_value_balance_zat],
      ["ironwood", tx.ironwood_value_balance_zat],
    ];
    for (const [pool, balance] of balances) {
      if (balance === null) continue;
      const key = `${day} ${pool}`;
      const d = this.days.get(key) ?? { inflow: 0n, outflow: 0n, txs: 0 };
      if (balance > 0n) d.inflow += balance;
      else d.outflow -= balance;
      d.txs++;
      this.days.set(key, d);
    }
  }

  rows(finalDay: string): Record<string, unknown>[] {
    return [...this.days]
      .map(([key, d]) => {
        const [day, pool] = key.split(" ") as [string, string];
        return { day, pool, inflow_zat: d.inflow, outflow_zat: d.outflow, txs: d.txs };
      })
      .filter((r) => r.day <= finalDay)
      .sort((a, b) => byCodePoint(a.day, b.day) || byCodePoint(a.pool, b.pool));
  }
}

/** Block rewards paid straight into shielded pools per UTC day (shielded coinbase, ZIP 213). */
export class DailyShieldedCoinbase {
  private readonly days = new Map<
    string,
    { coinbases: number; shielded: number; sapling: bigint; orchard: bigint; ironwood: bigint }
  >();

  push(tx: MetricTx): void {
    if (tx.kind !== "coinbase") return;
    const day = utcDay(tx.timestamp);
    const d = this.days.get(day) ?? {
      coinbases: 0,
      shielded: 0,
      sapling: 0n,
      orchard: 0n,
      ironwood: 0n,
    };
    const sapling = tx.sapling_value_balance_zat ?? 0n;
    const orchard = tx.orchard_value_balance_zat ?? 0n;
    const ironwood = tx.ironwood_value_balance_zat ?? 0n;
    d.coinbases++;
    if (sapling > 0n || orchard > 0n || ironwood > 0n) d.shielded++;
    d.sapling += sapling;
    d.orchard += orchard;
    d.ironwood += ironwood;
    this.days.set(day, d);
  }

  rows(finalDay: string): Record<string, unknown>[] {
    return [...this.days.keys()]
      .filter((day) => day <= finalDay)
      .sort(byCodePoint)
      .map((day) => {
        const d = this.days.get(day)!;
        return {
          day,
          coinbase_txs: d.coinbases,
          shielded_coinbase_txs: d.shielded,
          to_sapling_zat: d.sapling,
          to_orchard_zat: d.orchard,
          to_ironwood_zat: d.ironwood,
        };
      });
  }
}

/**
 * Estimated network solution rate per UTC day: the day's work (difficulty × 8,192 per block)
 * over the time from the previous day's last block to this day's last, so n blocks span n
 * intervals and NU7's shorter target needs no special case. A span a miner's clock made zero or
 * negative is NULL, and so is the first day, which has no previous block.
 */
export class DailyHashrate {
  private readonly days = new Map<string, { work: number; start: bigint | null; end: bigint }>();
  private prevTimestamp: bigint | null = null;
  private prevDay: string | null = null;

  push(row: BlockRow): void {
    const day = utcDay(row.timestamp);
    let d = this.days.get(day);
    if (!d) {
      d = { work: 0, start: day === this.prevDay ? null : this.prevTimestamp, end: row.timestamp };
      this.days.set(day, d);
    }
    if (row.difficulty !== null) d.work += row.difficulty * SOLUTIONS_PER_DIFFICULTY;
    d.end = row.timestamp;
    this.prevTimestamp = row.timestamp;
    this.prevDay = day;
  }

  rows(finalDay: string): Record<string, unknown>[] {
    return [...this.days.keys()]
      .filter((day) => day <= finalDay)
      .sort(byCodePoint)
      .map((day) => {
        const d = this.days.get(day)!;
        const span = d.start === null ? 0 : Number(d.end - d.start);
        return { day, solutions_per_second: span > 0 ? d.work / span : null };
      });
  }
}

/**
 * Supply per UTC day, at the day's last block: what the protocol's schedule allowed so far, what
 * exists (every pool, the lockbox and, from NU7, the NSM), and the difference, which is subsidy
 * miners never claimed. NSM receives floor(6 × fees / 10) of each block from NU7 (ZIP 235),
 * whatever the miner claims. A pool's NULL counts as zero only before its first reported value;
 * a NULL after that leaves the day's supply unknown, never estimated.
 */
export class DailySupply {
  private readonly days = new Map<
    string,
    { schedule: bigint; issued: bigint | null; nsm: bigint; nsmTotal: bigint }
  >();
  private schedule = 0n;
  private nsmTotal = 0n;
  private readonly started = new Set<string>();

  push(row: BlockRow): void {
    this.schedule += BigInt(blockSubsidyZat(row.height));
    let nsm = 0n;
    if (nu7ActiveAt("mainnet", row.height) && row.total_fee_zat !== null) {
      nsm = (row.total_fee_zat * 6n) / 10n;
    }
    this.nsmTotal += nsm;

    let issued: bigint | null = this.nsmTotal;
    const pools: [string, bigint | null][] = [
      ["transparent", row.transparent_pool_zat],
      ["sprout", row.sprout_pool_zat],
      ["sapling", row.sapling_pool_zat],
      ["orchard", row.orchard_pool_zat],
      ["lockbox", row.lockbox_pool_zat],
      ["ironwood", row.ironwood_pool_zat],
    ];
    for (const [pool, value] of pools) {
      if (value !== null) {
        this.started.add(pool);
        if (issued !== null) issued += value;
      } else if (this.started.has(pool)) {
        issued = null;
      }
    }

    const day = utcDay(row.timestamp);
    const d = this.days.get(day) ?? { schedule: 0n, issued: null, nsm: 0n, nsmTotal: 0n };
    d.schedule = this.schedule;
    d.issued = issued;
    d.nsm += nsm;
    d.nsmTotal = this.nsmTotal;
    this.days.set(day, d);
  }

  rows(finalDay: string): Record<string, unknown>[] {
    return [...this.days.keys()]
      .filter((day) => day <= finalDay)
      .sort(byCodePoint)
      .map((day) => {
        const d = this.days.get(day)!;
        return {
          day,
          schedule_zat: d.schedule,
          issued_zat: d.issued,
          unclaimed_zat: d.issued === null ? null : d.schedule - d.issued,
          nsm_zat: d.nsm,
          nsm_total_zat: d.nsmTotal,
        };
      });
  }
}
