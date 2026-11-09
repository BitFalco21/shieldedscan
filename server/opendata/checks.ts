import { NU7_HEIGHT, scheduledSubsidyZat } from "@/domain/halving";
import { LOCKBOX_DISBURSEMENTS } from "@/domain/lockbox-disbursement";
import { minerRewardAboveIssuance } from "@/domain/miner";
import { POOL_COLUMNS, PUBLISHED_CLIENTS, PUBLISHED_VERSION } from "./tables";

/**
 * The checks a release must pass before anything is uploaded. Failures stop the run; alerts are
 * reported and do not. They test the data against the chain's own arithmetic, which the live API
 * cannot do (it reads the same database), so they are what catches a wrong number.
 */

export interface BlockRow {
  height: number;
  hash: string;
  prev_hash: string;
  timestamp: bigint;
  size_bytes: number;
  tx_count: number;
  transparent_tx_count: number;
  mixed_tx_count: number;
  shielded_tx_count: number;
  total_fee_zat: bigint | null;
  sapling_flow_zat: bigint;
  orchard_flow_zat: bigint;
  transparent_pool_zat: bigint | null;
  sprout_pool_zat: bigint | null;
  sapling_pool_zat: bigint | null;
  orchard_pool_zat: bigint | null;
  lockbox_pool_zat: bigint | null;
  ironwood_pool_zat: bigint | null;
  difficulty: number | null;
  miner_kind: string | null;
  miner_reward_zat: bigint | null;
}

/** The one-time lockbox disbursement at the NU6.1 boundary: 78,750 ZEC out, checked 2026-10-31. */
export const LOCKBOX_DISBURSEMENT_HEIGHT = LOCKBOX_DISBURSEMENTS.find(
  (d) => d.network === "mainnet",
)!.height;

/**
 * Sprout emptied at 407 and the node reports it as not monitored until 416 (`getblock`
 * `valuePools`), so those cells are NULL in the middle of the column. Checked 2026-10-31.
 */
const SPROUT_UNMONITORED = { from: 407, to: 415 };

/** Below this the subsidy ramps up (slow start); `scheduledSubsidyZat` does not model it. */
const SLOW_START_END = 20_000;

const MINER_KINDS = new Set(["transparent", "shielded", "unknown"]);

/** A report kept short: the first few examples of a failure and how many there were. */
export class Findings {
  private readonly counts = new Map<string, number>();
  private readonly examples = new Map<string, string[]>();
  add(rule: string, example: string) {
    this.counts.set(rule, (this.counts.get(rule) ?? 0) + 1);
    const ex = this.examples.get(rule) ?? [];
    if (ex.length < 3) ex.push(example);
    this.examples.set(rule, ex);
  }
  list(): string[] {
    return [...this.counts].map(
      ([rule, n]) => `${rule}: ${n} (e.g. ${this.examples.get(rule)!.join("; ")})`,
    );
  }
  get size() {
    return this.counts.size;
  }
}

const utcDay = (unixSeconds: bigint) =>
  new Date(Number(unixSeconds) * 1000).toISOString().slice(0, 10);

/** A `YYYY-MM-DD` day `n` days later (or earlier), in UTC. */
const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * Checks blocks one at a time, in height order from 0, so a full release never needs all three
 * and a half million rows in memory at once.
 */
export class BlockChecker {
  private prev: BlockRow | null = null;
  private readonly started = new Set<string>();
  readonly failures = new Findings();
  readonly alerts = new Findings();
  /** Heights where the coinbase claimed less than the subsidy (value destroyed, not an error). */
  underClaimed = 0;
  /** Mixed transactions per UTC day, for the cross-check against the daily direction counts. */
  readonly mixedPerDay = new Map<string, number>();

  push(row: BlockRow): void {
    const h = row.height;
    const prev = this.prev;

    if (prev === null ? h !== 0 : h !== prev.height + 1) {
      this.failures.add("height gap", `${prev?.height ?? -1} then ${h}`);
    }
    if (!/^[0-9a-f]{64}$/.test(row.hash) || !/^[0-9a-f]{64}$/.test(row.prev_hash)) {
      this.failures.add("malformed hash", String(h));
    }
    if (prev !== null && row.prev_hash !== prev.hash) {
      this.failures.add("prev_hash does not link", String(h));
    }

    for (const col of POOL_COLUMNS) {
      const v = row[col];
      if (v === null) {
        const exempt =
          col === "sprout_pool_zat" && h >= SPROUT_UNMONITORED.from && h <= SPROUT_UNMONITORED.to;
        if (this.started.has(col) && !exempt)
          this.failures.add(`${col} NULL after a value`, String(h));
      } else {
        this.started.add(col);
        if (v < 0n) this.failures.add(`${col} negative`, String(h));
      }
    }

    if (prev !== null) {
      const flow = (pool: "sapling" | "orchard") => {
        const now = row[`${pool}_pool_zat`];
        const before = prev[`${pool}_pool_zat`];
        if (now !== null && before !== null && now - before !== row[`${pool}_flow_zat`]) {
          this.failures.add(`${pool} flow differs from its pool's change`, String(h));
        }
      };
      flow("sapling");
      flow("orchard");

      const lock = row.lockbox_pool_zat;
      const lockBefore = prev.lockbox_pool_zat;
      if (lock !== null && lockBefore !== null && lock < lockBefore) {
        if (h >= NU7_HEIGHT) this.alerts.add("lockbox decreased (from NU7)", String(h));
        else if (h !== LOCKBOX_DISBURSEMENT_HEIGHT)
          this.failures.add("lockbox decreased", String(h));
      }

      // Fees move between pools; the claimed subsidy is the only value that enters. Compared only
      // where the same pools report at both heights, so a pool starting to report is not a jump.
      const sameShape = POOL_COLUMNS.every((col) => (row[col] === null) === (prev[col] === null));
      if (h < NU7_HEIGHT && sameShape) {
        const total = (r: BlockRow) => POOL_COLUMNS.reduce((s, col) => s + (r[col] ?? 0n), 0n);
        const delta = total(row) - total(prev);
        const ceiling = h >= SLOW_START_END ? BigInt(scheduledSubsidyZat(h)) : 1_250_000_000n;
        if (delta < 0n || delta > ceiling) {
          this.failures.add("pools grew by more than the subsidy, or shrank", `${h}: ${delta}`);
        } else if (h >= SLOW_START_END && delta < ceiling) this.underClaimed++;
      }
    }

    if (row.total_fee_zat !== null && row.total_fee_zat < 0n)
      this.failures.add("negative fee", String(h));
    if (row.miner_kind !== null && !MINER_KINDS.has(row.miner_kind)) {
      this.failures.add("unknown miner_kind", String(h));
    }
    if (row.miner_reward_zat !== null && row.miner_kind !== "transparent") {
      this.failures.add("miner reward on a non-transparent coinbase", String(h));
    }
    // More than the block could pay anyone means a non-miner output was counted as the miner's.
    // An alert, not a failure: a stored row is corrected by a supervised repair, and a release
    // must not wait on one; the manifest names the heights until the repair has run.
    if (
      row.miner_reward_zat !== null &&
      minerRewardAboveIssuance(
        h,
        Number(row.miner_reward_zat),
        row.total_fee_zat === null ? null : Number(row.total_fee_zat),
      ) === true
    ) {
      this.alerts.add("miner reward above subsidy plus fees", String(h));
    }

    const day = utcDay(row.timestamp);
    this.mixedPerDay.set(day, (this.mixedPerDay.get(day) ?? 0) + row.mixed_tx_count);
    this.prev = row;
  }

  /** The last block seen, for the completeness check against the release height. */
  get last(): BlockRow | null {
    return this.prev;
  }
}

export interface Report {
  failures: string[];
  alerts: string[];
}

/** Directions within a day's mixed transactions must add up, per pool. */
export function checkPoolUsage(
  rows: readonly {
    day: string;
    pool: string;
    mixed: number;
    shielding: number;
    unshielding: number;
    indeterminate: number;
  }[],
): Report {
  const f = new Findings();
  for (const r of rows) {
    if (!["sprout", "sapling", "orchard", "ironwood"].includes(r.pool))
      f.add("unknown pool", r.pool);
    if (r.shielding + r.unshielding + r.indeterminate !== r.mixed) {
      f.add("pool_usage directions do not add up to mixed", `${r.day} ${r.pool}`);
    }
  }
  return { failures: f.list(), alerts: [] };
}

/** A day's direction counts must equal the mixed transactions its blocks recorded. */
export function checkShieldingDaily(
  rows: readonly {
    day: string;
    shielding_txs: bigint;
    unshielding_txs: bigint;
    indeterminate_txs: bigint;
  }[],
  mixedPerDay: ReadonlyMap<string, number>,
): Report {
  const f = new Findings();
  for (const r of rows) {
    const directions = r.shielding_txs + r.unshielding_txs + r.indeterminate_txs;
    if (directions !== BigInt(mixedPerDay.get(r.day) ?? 0)) {
      f.add(
        "daily directions differ from the blocks' mixed count",
        `${r.day}: ${directions} vs ${mixedPerDay.get(r.day) ?? 0}`,
      );
    }
  }
  return { failures: f.list(), alerts: [] };
}

/** What the supply audit knows at the release height (`DailySupply`). */
export interface SupplyAtRelease {
  unclaimedZat: bigint | null;
  /** The first post-NU7 height whose fee total is unknown, which leaves the NSM unknown. */
  unknownFeeFrom: number | null;
  /** Whether every reporting pool had a value at the release height. */
  poolsKnown: boolean;
}

/**
 * The ledger's underclaim against the supply audit at the release height: what coinbases left
 * unclaimed, read from their outputs and the fees, must equal the schedule less every pool's
 * balance. The subsidy appears on both sides and cancels, so this holds the ledger's values to
 * the node's pools, not the schedule. A block whose underclaim the ledger could not derive is
 * outside its sum (`skippedBlocks`) and inside the audit's, so the two can then differ.
 *
 * From NU7 a block's unknown fee leaves its NSM share unknown, and with it the supply: nothing
 * to compare, and nothing wrong in the data, so that one case is an alert. The published supply
 * stays NULL from that block on; any other unknown supply still stops the release.
 */
export function checkUnderclaim(
  ledgerZat: bigint,
  supply: SupplyAtRelease,
  skippedBlocks = 0,
): Report {
  if (supply.unclaimedZat === null) {
    if (supply.poolsKnown && supply.unknownFeeFrom !== null) {
      return {
        failures: [],
        alerts: [
          "ledger underclaim not cross-checked: the supply is unknown from " +
            `${supply.unknownFeeFrom}, a post-NU7 block whose fee is unknown`,
        ],
      };
    }
    return {
      failures: ["ledger underclaim: the supply at the release height is unknown"],
      alerts: [],
    };
  }
  if (ledgerZat === supply.unclaimedZat) return { failures: [], alerts: [] };
  const skipped =
    skippedBlocks > 0
      ? `; ${skippedBlocks} blocks whose underclaim could not be derived are outside the ledger's sum`
      : "";
  return {
    failures: [
      `ledger underclaim ${ledgerZat} zat differs from the supply audit's ` +
        `${supply.unclaimedZat} zat${skipped}`,
    ],
    alerts: [],
  };
}

/**
 * `nsm_daily` against `supply_daily`, day by day: two accumulators over the same blocks, so they
 * must agree exactly, NULLs included. A supply day with no NSM row is before NU7 and must hold
 * zero. The running totals at the release height must agree too.
 */
export function checkNsm(
  nsmRows: readonly Record<string, unknown>[],
  supplyRows: readonly Record<string, unknown>[],
  totals: { nsm: bigint | null; supply: bigint | null },
): Report {
  const f = new Findings();
  const supply = new Map(supplyRows.map((r) => [String(r.day), r]));
  const nsmDays = new Set<string>();
  for (const r of nsmRows) {
    const day = String(r.day);
    nsmDays.add(day);
    const s = supply.get(day);
    if (s === undefined) f.add("nsm_daily day missing from supply_daily", day);
    else if (r.nsm_inflow_zat !== s.nsm_zat || r.nsm_total_zat !== s.nsm_total_zat) {
      f.add("nsm_daily differs from supply_daily", day);
    }
  }
  for (const [day, s] of supply) {
    if (!nsmDays.has(day) && (s.nsm_zat !== 0n || s.nsm_total_zat !== 0n)) {
      f.add("NSM in supply_daily on a day without an nsm_daily row", day);
    }
  }
  if (totals.nsm !== totals.supply) {
    f.add(
      "NSM total at the release differs from the supply audit's",
      `${totals.nsm ?? "NULL"} vs ${totals.supply ?? "NULL"}`,
    );
  }
  return { failures: f.list(), alerts: [] };
}

/** The NU7 release mapping: published clients, plain versions, https release notes. */
export function checkCapableReleases(
  rows: readonly { client: string; min_version: string; source_url: string }[],
): Report {
  const f = new Findings();
  for (const r of rows) {
    if (!PUBLISHED_CLIENTS.has(r.client)) f.add("NU7 release of an unpublished client", r.client);
    if (!PUBLISHED_VERSION.test(r.min_version)) f.add("NU7 release version malformed", r.client);
    if (!/^https:\/\/[a-z0-9.-]+\/\S*$/.test(r.source_url)) {
      f.add("NU7 release source is not an https link", r.client);
    }
  }
  return { failures: f.list(), alerts: [] };
}

/** What a published node row may say about the client: a known name and a well-formed version. */
export function publishedRelease(client: string, version: string | null) {
  const known = PUBLISHED_CLIENTS.has(client);
  return {
    client: known ? client : "other",
    version: known && version !== null && PUBLISHED_VERSION.test(version) ? version : null,
  };
}

const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;
const IPV6 = /\b[0-9a-f]{1,4}(?::[0-9a-f]{0,4}){2,7}\b/i;
const URLISH = /[a-z][a-z0-9+.-]*:\/\/|www\.|\.onion\b|@/i;
const ZCASH_ADDRESS = /\b(?:t1|t3|zs1|u1|tex1|zc)[0-9a-z]{20,}/i;

/**
 * Only hex digits. None of the patterns below can match such a string (each needs a dot, a colon,
 * an `@`, a `w`, or a `t`/`u`/`z` prefix), so skipping it is exact, and it makes the ledger's
 * hundreds of millions of txids cheap to scan.
 */
const HEX_ONLY = /^[0-9a-f]*$/i;

/**
 * Columns the scan does not apply to, each held by its own check instead. Listed by name so no
 * other column can slip past it.
 * - `blocks_coinbase.coinbase_tag`: miner-written text, published as such (the card says so).
 *   Pool tags carry URLs and handles; it is sanitised at parse and held to that form
 *   (`CoinbaseChecker`).
 * - `blocks_coinbase.miner_address`: a payout address is the column's content; each one must be
 *   a mainnet t-address (`CoinbaseChecker`).
 * - `nu7_capable_releases.source_url`: our own constant, never read from the database
 *   (`checkCapableReleases`).
 */
const SCAN_EXEMPT: ReadonlySet<string> = new Set([
  "blocks_coinbase.coinbase_tag",
  "blocks_coinbase.miner_address",
  "nu7_capable_releases.source_url",
]);

/**
 * The second lock behind the per-column formats: no published string may look like an address of
 * any kind. Version strings are allowed their dots (`1.7.0` is not an IPv4 address).
 */
export function scanStrings(
  table: string,
  column: string,
  values: Iterable<string | null>,
): string[] {
  if (SCAN_EXEMPT.has(`${table}.${column}`)) return [];
  const out: string[] = [];
  for (const v of values) {
    if (v === null || HEX_ONLY.test(v)) continue;
    const ipv4 = column !== "version" && IPV4.test(v);
    if (ipv4 || IPV6.test(v) || URLISH.test(v) || ZCASH_ADDRESS.test(v)) {
      out.push(`${table}.${column}: a value looks like an address`);
      break;
    }
  }
  return out;
}

/**
 * Plain code-point order. Never `localeCompare`: its order depends on the machine's locale, and
 * the same rows must give the same bytes everywhere.
 */
const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export { addDays, byCodePoint, utcDay };
