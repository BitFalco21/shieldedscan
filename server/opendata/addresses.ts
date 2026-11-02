import type { Client } from "pg";
import { byCodePoint, Findings } from "./checks";
import { writeFile, type OutputFile } from "./read";
import { isMainnetTransparentAddress } from "./site-checks";
import { ADDRESS_COLUMNS, ADDRESSES_FILE } from "./tables";

/**
 * `addresses`: every transparent address with a positive balance, at the release height N.
 *
 * The source is the site's rich list (`chain_address_balance`), which the follower moves forward
 * in the same transaction as each block, so it stands at its own `computed_height` C, normally
 * the tip and so about 100 blocks above N. It is read, with C and the unattributed total, in one
 * snapshot, held to the transparent pool at C, then rewound to N by subtracting what the ledger
 * moved in (N, C], and held to the pool at N. The file is therefore exactly at N like every other
 * table, and anyone can repeat the last check from the published `blocks`.
 *
 * A rewound address keeps its transaction count minus the (N, C] ones; one the rich list dropped
 * after N (spent to zero) is restored with a NULL count, which is not kept for dropped rows.
 */

/** Rows per balance read: bounded queries, each an index range on the primary key. */
const CHUNK = 100_000;
/** Heights per rewind query. */
const REWIND_CHUNK = 1_000;
/**
 * How far above N the balances may stand. C never passes the tip, so only a release whose sync
 * state lags the rich list by this much reaches it: a guard on the rewind's size, not a lag rule.
 */
export const MAX_REWIND = 2_000;

export interface AddressesContext {
  /** The release's snapshot connection, outside any transaction. */
  client: Client;
  height: number;
  /** Block N's hash as the release read it: the rewind must land on that same block. */
  hash: string;
  /** Called between reads, to watch the follower. */
  afterChunk: () => Promise<void>;
}

export interface AddressesOptions {
  outDir: string;
  chunk?: number;
  rewindChunk?: number;
  maxRewind?: number;
}

export interface AddressesOutcome {
  /** Null when a check failed: nothing is written then. */
  file: OutputFile | null;
  failures: string[];
  height: number;
  /** The rich list's `computed_height` the snapshot was read at, before the rewind. */
  rewoundFrom: number | null;
  rows: number;
}

export interface Balances {
  address: string[];
  balance: bigint[];
  txCount: (bigint | null)[];
}

/** What one address, or the unattributed total, gained over a height range, and in how many txs. */
export interface Delta {
  zat: bigint;
  txs: bigint;
}

/**
 * Balances at C less what (N, C] moved, keeping only positive balances. `deltas` is keyed by
 * address. A count is subtracted too: a txid sits in one block, so per-range counts add up.
 */
export function rewind(at: Balances, deltas: ReadonlyMap<string, Delta>, f: Findings): Balances {
  const out: Balances = { address: [], balance: [], txCount: [] };
  const push = (address: string, balance: bigint, txs: bigint | null) => {
    // Addresses are never echoed: one that fails here has not been validated yet.
    if (balance < 0n) f.add("address balance below zero at the release height", `${balance} zat`);
    if (balance <= 0n) return;
    if (txs !== null && txs <= 0n) f.add("address balance with no transaction", `${txs} txs`);
    out.address.push(address);
    out.balance.push(balance);
    out.txCount.push(txs);
  };
  const consumed = new Set<string>();
  for (let i = 0; i < at.address.length; i++) {
    const address = at.address[i]!;
    const d = deltas.get(address);
    if (d) consumed.add(address);
    const balance = at.balance[i]!;
    const txs = at.txCount[i]!;
    if (!d) push(address, balance, txs);
    else push(address, balance - d.zat, txs === null ? null : txs - d.txs);
  }
  // Emptied after N, so no longer in the rich list: its count before N is not known.
  for (const [address, d] of deltas) if (!consumed.has(address)) push(address, -d.zat, null);
  return out;
}

/** Σ balances + unattributed must equal the node's transparent pool at the same height. */
export function checkIdentity(
  f: Findings,
  height: number,
  balances: bigint,
  unattributed: bigint,
  pool: bigint | null,
): void {
  if (pool === null) {
    f.add("no transparent pool to hold the address balances to", `height ${height}`);
    return;
  }
  const sum = balances + unattributed;
  if (sum !== pool) {
    f.add(
      "address balances and unattributed value do not add up to the transparent pool",
      `height ${height}: ${sum} vs ${pool} zat`,
    );
  }
}

/** In code-point order, each address once, each a mainnet t-address. */
export function sortAndValidate(b: Balances, f: Findings): Balances {
  const order = Array.from(b.address.keys()).sort((i, j) =>
    byCodePoint(b.address[i]!, b.address[j]!),
  );
  const out: Balances = {
    address: order.map((i) => b.address[i]!),
    balance: order.map((i) => b.balance[i]!),
    txCount: order.map((i) => b.txCount[i]!),
  };
  for (let i = 0; i < out.address.length; i++) {
    const a = out.address[i]!;
    if (i > 0 && a === out.address[i - 1]) f.add("address listed twice", `row ${i}`);
    if (!isMainnetTransparentAddress(a)) {
      f.add("address is not a mainnet t-address", `${a.length} characters`);
    }
  }
  return out;
}

const DELTA_SQL = `
  SELECT address,
         COALESCE(SUM(CASE WHEN io = 'out' THEN value_zat ELSE -value_zat END), 0)::bigint AS zat,
         COUNT(DISTINCT txid)::bigint AS txs,
         COUNT(*) FILTER (WHERE value_zat IS NULL)::bigint AS unknown
    FROM opendata.transparent_io
   WHERE block_height BETWEEN $1 AND $2
   GROUP BY address`;

export async function readAddresses(
  ctx: AddressesContext,
  opts: AddressesOptions,
): Promise<AddressesOutcome> {
  const { client, height } = ctx;
  const f = new Findings();
  const outcome = (rewoundFrom: number | null, rows = 0, file: OutputFile | null = null) => ({
    file,
    failures: f.list(),
    height,
    rewoundFrom,
    rows,
  });

  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  let at: Balances;
  let unattributed: bigint;
  let from: number;
  const deltas = new Map<string, Delta>();
  try {
    const meta = await client.query<{ computed_height: number; unattributed_zat: bigint }>(
      "SELECT computed_height, unattributed_zat FROM opendata.addresses_meta",
    );
    const m = meta.rows[0];
    if (!m) {
      f.add("address balances never computed", "no opendata.addresses_meta row");
      await client.query("COMMIT");
      return outcome(null);
    }
    from = m.computed_height;
    const maxRewind = opts.maxRewind ?? MAX_REWIND;
    if (from < height || from - height > maxRewind) {
      f.add(
        "address balances too far from the release height",
        `at ${from}, release ${height}, rewound at most ${maxRewind} blocks down`,
      );
      await client.query("COMMIT");
      return outcome(from);
    }
    const blocks = await client.query<{
      height: number;
      hash: string;
      transparent_pool_zat: bigint | null;
    }>(
      `SELECT height, hash, transparent_pool_zat FROM opendata.blocks
        WHERE height IN ($1, $2)`,
      [height, from],
    );
    const pool = (h: number) => blocks.rows.find((r) => r.height === h);
    if (pool(height)?.hash !== ctx.hash) {
      f.add("block at the release height changed under the address read", `height ${height}`);
      await client.query("COMMIT");
      return outcome(from);
    }

    at = { address: [], balance: [], txCount: [] };
    let sumAtC = 0n;
    // Keyset on the primary key in its own collation, so each read is an index range; the file's
    // code-point order is applied after, in memory. '' sorts before any address in any collation.
    let after = "";
    const chunk = opts.chunk ?? CHUNK;
    for (;;) {
      const { rows } = await client.query<{
        address: string;
        balance_zat: bigint;
        tx_count: bigint | null;
      }>(
        `SELECT address, balance_zat, tx_count FROM opendata.addresses
          WHERE address > $1 ORDER BY address LIMIT $2`,
        [after, chunk],
      );
      for (const r of rows) {
        if (r.balance_zat <= 0n)
          f.add("rich list balance that is not positive", `${r.balance_zat}`);
        at.address.push(r.address);
        at.balance.push(r.balance_zat);
        at.txCount.push(r.tx_count);
        sumAtC += r.balance_zat;
      }
      await ctx.afterChunk();
      if (rows.length < chunk) break;
      after = rows.at(-1)!.address;
    }
    unattributed = m.unattributed_zat;
    checkIdentity(f, from, sumAtC, unattributed, pool(from)?.transparent_pool_zat ?? null);

    const step = opts.rewindChunk ?? REWIND_CHUNK;
    for (let a = height + 1; a <= from; a += step) {
      const { rows } = await client.query<{
        address: string | null;
        zat: bigint;
        txs: bigint;
        unknown: bigint;
      }>(DELTA_SQL, [a, Math.min(from, a + step - 1)]);
      for (const r of rows) {
        // An input not yet resolved: the follower's sum skipped it too, so the rewind cannot be
        // trusted (the identity at C would show it as well).
        if (r.unknown > 0n)
          f.add("transparent value unknown in the rewind range", `${r.unknown} rows`);
        if (r.address === null) {
          unattributed -= r.zat;
          continue;
        }
        const d = deltas.get(r.address) ?? { zat: 0n, txs: 0n };
        d.zat += r.zat;
        d.txs += r.txs;
        deltas.set(r.address, d);
      }
      await ctx.afterChunk();
    }
    await client.query("COMMIT");

    const atN = rewind(at, deltas, f);
    const sumAtN = atN.balance.reduce((s, b) => s + b, 0n);
    checkIdentity(f, height, sumAtN, unattributed, pool(height)?.transparent_pool_zat ?? null);
    const sorted = sortAndValidate(atN, f);
    if (f.size > 0) return outcome(from, sorted.address.length);
    const file = writeFile(opts.outDir, ADDRESSES_FILE, ADDRESS_COLUMNS, [
      sorted.address,
      sorted.balance,
      sorted.txCount,
    ]);
    return outcome(from, file.rows, file);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  }
}
