import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { expect } from "vitest";
import { parseBlock, type ParsedBlock } from "@/data/chain/parse";
import type { RpcBlock } from "@/data/chain/rpc-types";
import mixedBlock from "@/data/chain/__fixtures__/block-3426950.json";
import ironwoodBlock from "@/data/chain/__fixtures__/block-3428150.json";
import sproutBlock from "@/data/chain/__fixtures__/block-460495.json";
import shieldedBlock from "@/data/chain/__fixtures__/block-3426998.json";
import { ROLLUP_TABLES, ROLLUP_VIEW_NAMES } from "../../rollup/definitions";
import { AVG_DIFFICULTY_TOLERANCE } from "../../rollup/compare";

/**
 * A synthetic chain for the rollup tests, and the oracle they are held to.
 *
 * Blocks are real captures re-stamped to a height, a timestamp and fresh txids, so every rollup
 * sees real transaction shapes: coinbase, transparent, mixed in both directions, Sapling, Orchard,
 * Ironwood migrations and Sprout JoinSplits. Their inputs point at outputs this chain never holds,
 * so only fully shielded transactions have a fee, which keeps both fee coverage cases in play.
 *
 * The oracle is the frozen view SQL (`legacy-rollup-matviews.sql`) loaded into the `legacy`
 * schema and refreshed under UTC.
 */

export type Template = "coinbase" | "mixed" | "ironwood" | "sprout" | "shielded";

const TEMPLATES: Record<Exclude<Template, "coinbase">, RpcBlock> = {
  mixed: mixedBlock as unknown as RpcBlock,
  ironwood: ironwoodBlock as unknown as RpcBlock,
  sprout: sproutBlock as unknown as RpcBlock,
  shielded: shieldedBlock as unknown as RpcBlock,
};

const hashOf = (height: number, fork: string) => `${fork}blk-${height}`.padEnd(64, "0");

export interface BlockSpec {
  height: number;
  time: number;
  template: Template;
  /** Distinguishes a reorg's replacement from the block it replaces. */
  fork?: string;
  /** Rename this block's transactions, e.g. to mine a mempool row. */
  txids?: Record<number, string>;
}

/** A parsed block, as the follower would ingest it. */
export function chainBlock(spec: BlockSpec): ParsedBlock {
  const fork = spec.fork ?? "a";
  const base = TEMPLATES[spec.template === "coinbase" ? "mixed" : spec.template];
  const txs = spec.template === "coinbase" ? base.tx.slice(0, 1) : base.tx;
  const raw: RpcBlock = {
    ...base,
    height: spec.height,
    time: spec.time,
    hash: hashOf(spec.height, fork),
    previousblockhash: hashOf(spec.height - 1, fork),
    // A different difficulty per block, so a day's mean is a real float sum.
    difficulty: base.difficulty * (1 + (spec.height % 7) / 3),
    // Pool totals that move with height, so a closing row read at the wrong block shows.
    valuePools: base.valuePools.map((p) =>
      p.chainValueZat == null ? p : { ...p, chainValueZat: p.chainValueZat + spec.height * 1000 },
    ),
    tx: txs.map((tx, i) => ({
      ...tx,
      txid: spec.txids?.[i] ?? `${fork}tx-${spec.height}-${i}`.padEnd(64, "0"),
    })),
  };
  return parseBlock(raw);
}

/** Unix seconds of a UTC date-time. */
export const at = (iso: string) => Date.parse(`${iso}Z`) / 1000;

function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

/** A fresh database with the chain schema applied; returns its URL. */
export async function freshDatabase(url: string, name: string): Promise<string> {
  const admin = new Pool({ connectionString: withDatabase(url, "postgres"), max: 1 });
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
  const dbUrl = withDatabase(url, name);
  const pool = new Pool({ connectionString: dbUrl, max: 1 });
  try {
    await applyChainSchema(pool);
  } finally {
    await pool.end();
  }
  return dbUrl;
}

export async function applyChainSchema(pool: Pool): Promise<void> {
  await pool.query(readFileSync("./server/schema-chain.sql", "utf8"));
}

export const LEGACY_SQL = readFileSync(
  "./server/__tests__/support/legacy-rollup-matviews.sql",
  "utf8",
);

/** The frozen views, created in `schema` (reading the chain tables in `public`). */
export async function createLegacyViews(pool: Pool, schema: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    await client.query(`SET search_path = ${schema}, public`);
    await client.query(LEGACY_SQL);
  } finally {
    await client.query("RESET search_path");
    client.release();
  }
}

/** Refresh every frozen view under UTC, as production refreshes them. */
export async function refreshLegacyViews(pool: Pool, schema: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SET TimeZone = 'UTC'");
    for (const name of ROLLUP_VIEW_NAMES) {
      await client.query(`REFRESH MATERIALIZED VIEW ${schema}.${name}`);
    }
  } finally {
    await client.query("RESET TimeZone");
    client.release();
  }
}

type Row = Record<string, unknown>;

async function rowsOf(pool: Pool, relation: string, columns: readonly string[]): Promise<Row[]> {
  const { rows } = await pool.query<Row>(
    `SELECT ${columns.join(", ")} FROM ${relation} ORDER BY ${columns.map((c) => `${c}::text`).join(", ")}`,
  );
  return rows;
}

/**
 * Assert `table` holds exactly the rows of `oracle`, for every rollup that replaced a view.
 *
 * Independent of the production comparison code: both sides are read whole, sorted on every
 * column, and compared value for value. The one float column (a mean whose last bits depend on
 * summation order) is compared within the same relative tolerance the check uses.
 */
export async function expectRollupsEqual(
  pool: Pool,
  relation: (name: string) => string,
  oracle: (name: string) => string,
  context: string,
): Promise<void> {
  for (const table of ROLLUP_TABLES) {
    if (!table.replacesView) continue;
    const got = await rowsOf(pool, relation(table.name), table.columns);
    const want = await rowsOf(pool, oracle(table.name), table.columns);
    const label = `${context}: ${table.name}`;
    if (table.name !== "chain_day_network") {
      expect(got, label).toEqual(want);
      continue;
    }
    expect(got.length, label).toBe(want.length);
    got.forEach((g, i) => {
      const w = want[i]!;
      expect({ ...g, avg_difficulty: null }, label).toEqual({ ...w, avg_difficulty: null });
      const [a, b] = [Number(g.avg_difficulty), Number(w.avg_difficulty)];
      expect(
        Math.abs(a - b) <= AVG_DIFFICULTY_TOLERANCE * Math.max(Math.abs(a), Math.abs(b)),
        label,
      ).toBe(true);
    });
  }
}

/** Column names and types of a relation, in order. */
export async function columnTypes(pool: Pool, relation: string): Promise<string[]> {
  const { rows } = await pool.query<{ c: string }>(
    `SELECT attname || ' ' || format_type(atttypid, atttypmod) AS c
       FROM pg_attribute
      WHERE attrelid = to_regclass($1) AND attnum > 0 AND NOT attisdropped
      ORDER BY attnum`,
    [relation],
  );
  return rows.map((r) => r.c);
}

/** Rows still waiting in the dirty-period log. */
export async function pendingMarks(pool: Pool): Promise<number> {
  const { rows } = await pool.query<{ n: string }>("SELECT count(*) AS n FROM chain_rollup_dirty");
  return Number(rows[0]?.n ?? 0);
}
