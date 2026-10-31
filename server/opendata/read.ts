import { createHash } from "node:crypto";
import { Client, types as pgTypes, type ClientConfig } from "pg";
import { classifyReleaseGroups } from "../netmap/releases";
import {
  BlockChecker,
  checkPoolUsage,
  checkShieldingDaily,
  publishedRelease,
  scanStrings,
  type BlockRow,
} from "./checks";
import { arrowTable, toParquet, type ColumnSpec, type ColumnValues } from "./parquet";
import {
  BLOCK_COLUMNS,
  BLOCKS_PER_FILE,
  blocksFile,
  SMALL_TABLES,
  type SmallTable,
} from "./tables";

/**
 * One release, read from one consistent snapshot of the database and checked before a single
 * byte is written anywhere.
 *
 * Two connections: the snapshot (`REPEATABLE READ READ ONLY`), where every table is read as of the
 * same instant, and a probe in autocommit that watches the follower between chunks (inside the
 * snapshot the follower's progress is frozen at its start). If the follower falls behind, the
 * export stops: ingestion always wins.
 */

/** Blocks below the tip that are not yet published: far deeper than any Zcash reorg. */
export const CONFIRMATIONS = 100;
/** Rows per read, and per record batch: the same every run, so row groups never move. */
const CHUNK = 100_000;
/** Follower silence that, seen twice in a row, stops the export. */
const MAX_FOLLOWER_LAG_S = 600;
/** Days the daily trackers keep recomputing; a day is final once it is this far behind block N. */
const SETTLING_DAYS = 3;

/**
 * Type parsers for these connections only. The rest of the server reads BIGINT as a JS number
 * (`server/pg-types.ts`, process-wide); here every BIGINT is a BigInt and every DATE its string,
 * whatever any other module registered, so no amount loses precision and no timezone moves a day.
 */
const exportTypes: NonNullable<ClientConfig["types"]> = {
  getTypeParser: ((oid: number, format?: "text" | "binary") => {
    if (oid === 20) return (v: string) => BigInt(v);
    if (oid === 1082) return (v: string) => v;
    if (oid === 1700) {
      return () => {
        throw new Error("NUMERIC is not exported: read it as BIGINT or a string");
      };
    }
    return pgTypes.getTypeParser(oid, format ?? "text");
  }) as NonNullable<ClientConfig["types"]>["getTypeParser"],
};

export interface OutputFile {
  path: string;
  bytes: Uint8Array;
  rows: number;
  /** sha256 of the file. */
  sha256: string;
  /** sha256 over the rows themselves, independent of encoding: what history checks compare. */
  contentSha256: string;
}

export interface Release {
  height: number;
  hash: string;
  /** Days up to and including this one are final in the daily tables. */
  finalDay: string;
  files: OutputFile[];
  failures: string[];
  alerts: string[];
  underClaimed: number;
}

export interface ReadOptions {
  connection: ClientConfig;
  /** Seconds since the epoch, for "yesterday" in the node table. */
  now?: () => number;
  log?: (line: string) => void;
}

const sha256 = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");

/** A canonical serialisation of rows: BigInts as decimal strings, so the digest is exact. */
function contentDigest(columns: readonly ColumnSpec[], values: readonly ColumnValues[]): string {
  const h = createHash("sha256");
  h.update(JSON.stringify(columns.map((c) => [c.name, c.type, c.nullable])));
  const rows = values[0]?.length ?? 0;
  for (let i = 0; i < rows; i++) {
    h.update(
      JSON.stringify(
        values.map((col) => {
          const v = col[i];
          return typeof v === "bigint" ? `${v}n` : v;
        }),
      ) + "\n",
    );
  }
  return h.digest("hex");
}

function file(path: string, columns: readonly ColumnSpec[], values: ColumnValues[]): OutputFile {
  const bytes = toParquet(arrowTable(columns, values));
  return {
    path,
    bytes,
    rows: values[0]?.length ?? 0,
    sha256: sha256(bytes),
    contentSha256: contentDigest(columns, values),
  };
}

/** Rows as column arrays, in the published column order. */
function toColumns(columns: readonly ColumnSpec[], rows: readonly Record<string, unknown>[]) {
  return columns.map((c) => rows.map((r) => (r[c.name] ?? null) as ColumnValues[number]));
}

/**
 * Plain code-point order. Never `localeCompare`: its order depends on the machine's locale, and
 * the same rows must give the same bytes everywhere.
 */
const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export async function readRelease(opts: ReadOptions): Promise<Release> {
  const log = opts.log ?? (() => {});
  const now = opts.now ?? (() => Math.floor(Date.now() / 1000));
  const probe = new Client({ ...opts.connection, types: exportTypes });
  const snap = new Client({ ...opts.connection, types: exportTypes });
  await probe.connect();
  await snap.connect();
  let lagStrikes = 0;
  const watchFollower = async () => {
    const { rows } = await probe.query<{ lag: bigint }>(
      "SELECT $1::bigint - updated_at AS lag FROM opendata.sync_state",
      [now()],
    );
    const lag = rows[0]?.lag ?? BigInt(Number.MAX_SAFE_INTEGER);
    lagStrikes = lag > BigInt(MAX_FOLLOWER_LAG_S) ? lagStrikes + 1 : 0;
    if (lagStrikes >= 2) throw new Error(`the follower has not written for ${lag} s: stopping`);
  };

  try {
    await watchFollower();
    await snap.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const tip = await snap.query<{ tip_height: number }>(
      "SELECT tip_height FROM opendata.sync_state",
    );
    const tipHeight = tip.rows[0]?.tip_height;
    if (tipHeight === undefined) throw new Error("no sync state");
    const height = Number(tipHeight) - CONFIRMATIONS;
    log(`release height ${height} (tip ${tipHeight})`);

    const files: OutputFile[] = [];
    const checker = new BlockChecker();
    const cols = BLOCK_COLUMNS.map((c) => c.name).join(", ");
    for (let start = 0; start <= height; start += BLOCKS_PER_FILE) {
      const end = Math.min(height, start + BLOCKS_PER_FILE - 1);
      const values: ColumnValues[] = BLOCK_COLUMNS.map(() => []);
      for (let a = start; a <= end; a += CHUNK) {
        const b = Math.min(end, a + CHUNK - 1);
        const { rows } = await snap.query<Record<string, unknown>>(
          `SELECT ${cols} FROM opendata.blocks WHERE height BETWEEN $1 AND $2 ORDER BY height`,
          [a, b],
        );
        for (const r of rows) {
          checker.push(r as unknown as BlockRow);
          BLOCK_COLUMNS.forEach((c, i) => (values[i] as unknown[]).push(r[c.name] ?? null));
        }
        await watchFollower();
      }
      files.push(file(blocksFile(start), BLOCK_COLUMNS, values));
      log(`${blocksFile(start)}: ${values[0]!.length} rows`);
    }

    const last = checker.last;
    const failures = checker.failures.list();
    if (last === null || last.height !== height) {
      failures.push(`blocks end at ${last?.height ?? "nothing"}, expected ${height}`);
    }
    const hash = last?.hash ?? "";
    // Final once three days behind block N's own day: every block of such a day is at or below N,
    // and the trackers have stopped recomputing it.
    const finalDay = addDays(
      new Date(Number(last?.timestamp ?? 0n) * 1000).toISOString().slice(0, 10),
      -SETTLING_DAYS,
    );
    const yesterday = addDays(new Date(now() * 1000).toISOString().slice(0, 10), -1);

    const small = async (table: SmallTable, sql: string, params: unknown[]) => {
      const columns = SMALL_TABLES[table];
      const { rows } = await snap.query<Record<string, unknown>>(sql, params);
      return { columns, rows };
    };

    const poolUsage = await small(
      "pool_usage_daily",
      `SELECT ${SMALL_TABLES.pool_usage_daily.map((c) => c.name).join(", ")} FROM opendata.pool_usage_daily
        WHERE day <= $1 AND close_height <= $2 ORDER BY day, pool COLLATE "C"`,
      [finalDay, height],
    );
    const shielding = await small(
      "shielding_daily",
      `SELECT ${SMALL_TABLES.shielding_daily.map((c) => c.name).join(", ")} FROM opendata.shielding_daily
        WHERE day <= $1 ORDER BY day`,
      [finalDay],
    );
    const transparent = await small(
      "transparent_daily",
      `SELECT ${SMALL_TABLES.transparent_daily.map((c) => c.name).join(", ")} FROM opendata.transparent_daily
        WHERE day <= $1 ORDER BY day`,
      [finalDay],
    );
    const monthly = await small(
      "transparent_monthly",
      `SELECT ${SMALL_TABLES.transparent_monthly.map((c) => c.name).join(", ")} FROM opendata.transparent_monthly
        WHERE complete AND (month + interval '1 month' - interval '1 day')::date <= $1 ORDER BY month`,
      [finalDay],
    );
    const reorgs = await small(
      "reorgs",
      // `height` is BIGINT in the source and int32 in the file; cast here, never in JS.
      `SELECT height::integer AS height, depth, orphaned_hash, replaced_by FROM opendata.reorgs
        WHERE height + depth <= $1 ORDER BY height, orphaned_hash COLLATE "C"`,
      [height],
    );
    const rawNodes = await snap.query<{
      day: string;
      user_agent: string;
      protocol_version: number;
      nodes: number;
      behind_tip: number;
      tip_unknown: number;
    }>(
      `SELECT day, user_agent, protocol_version, nodes, behind_tip, tip_unknown
         FROM opendata.node_releases_daily WHERE day <= $1 ORDER BY day`,
      [yesterday],
    );
    await snap.query("COMMIT");

    // Node rows: classified by the site's own function, then reduced to what may be published.
    const byDay = new Map<string, typeof rawNodes.rows>();
    for (const r of rawNodes.rows) byDay.set(r.day, [...(byDay.get(r.day) ?? []), r]);
    const nodeRows: Record<string, unknown>[] = [];
    for (const [day, rows] of byDay) {
      const merged = new Map<
        string,
        Record<string, unknown> & { nodes: number; behind_tip: number; tip_unknown: number }
      >();
      const groups = classifyReleaseGroups(
        rows.map((r) => ({
          userAgent: r.user_agent,
          protocolVersion: r.protocol_version,
          nodes: r.nodes,
          behindTip: r.behind_tip,
          tipUnknown: r.tip_unknown,
        })),
      );
      for (const g of groups) {
        const { client, version } = publishedRelease(g.client, g.version);
        const key = JSON.stringify([client, version, g.protocolVersion]);
        const m = merged.get(key) ?? {
          day,
          client,
          version,
          protocol_version: g.protocolVersion,
          nodes: 0,
          behind_tip: 0,
          tip_unknown: 0,
        };
        m.nodes += g.nodes;
        m.behind_tip += g.behindTip;
        m.tip_unknown += g.tipUnknown;
        merged.set(key, m);
      }
      nodeRows.push(
        ...[...merged.values()].sort(
          (a, b) =>
            byCodePoint(String(a.client), String(b.client)) ||
            byCodePoint(String(a.version ?? ""), String(b.version ?? "")) ||
            Number(a.protocol_version ?? -1) - Number(b.protocol_version ?? -1),
        ),
      );
    }

    const pu = checkPoolUsage(poolUsage.rows as never);
    const sd = checkShieldingDaily(shielding.rows as never, checker.mixedPerDay);
    failures.push(...pu.failures, ...sd.failures);

    const tables: [SmallTable, readonly ColumnSpec[], readonly Record<string, unknown>[]][] = [
      ["pool_usage_daily", poolUsage.columns, poolUsage.rows],
      ["shielding_daily", shielding.columns, shielding.rows],
      ["transparent_daily", transparent.columns, transparent.rows],
      ["transparent_monthly", monthly.columns, monthly.rows],
      ["node_releases_daily", SMALL_TABLES.node_releases_daily, nodeRows],
      ["reorgs", reorgs.columns, reorgs.rows],
    ];
    for (const [name, columns, rows] of tables) {
      const values = toColumns(columns, rows);
      columns.forEach((c, i) => {
        if (c.type === "utf8" && !/hash$/.test(c.name)) {
          failures.push(...scanStrings(name, c.name, values[i] as (string | null)[]));
        }
      });
      if (name === "reorgs") {
        for (const col of ["orphaned_hash", "replaced_by"]) {
          const i = columns.findIndex((c) => c.name === col);
          if ((values[i] as string[]).some((v) => !/^[0-9a-f]{64}$/.test(v))) {
            failures.push(`reorgs.${col}: a value is not a block hash`);
          }
        }
      }
      files.push(file(`${name}.parquet`, columns, values));
    }

    return {
      height,
      hash,
      finalDay,
      files,
      failures,
      alerts: checker.alerts.list(),
      underClaimed: checker.underClaimed,
    };
  } catch (e) {
    await snap.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    await snap.end().catch(() => {});
    await probe.end().catch(() => {});
  }
}
