/**
 * Measure what one rollup pass costs on this database, without writing anything.
 *
 *   node explain-rollups.mjs                        the pass shapes at the current tip
 *   node explain-rollups.mjs --month=2022-09 ...    plus a fill chunk for each month named
 *   node explain-rollups.mjs --plans                also print each plan's nodes
 *   node explain-rollups.mjs --timeout=300          per-statement timeout in seconds (default 300)
 *
 * Runs `EXPLAIN (ANALYZE, BUFFERS)` of every rollup's windowed SELECT inside one READ ONLY
 * transaction, under UTC as the pass runs. It needs no schema change, so it runs before the deploy
 * that introduces the tables: a month table derived from a day table reads the day view of the same
 * name, which has the same rows. The all-time tables read day helpers that exist only after that
 * deploy, and are skipped until then (they read a few thousand rows).
 *
 * The shapes:
 *  - "open day": the normal pass — the day tables over the tip's UTC day, the month tables over its
 *    month;
 *  - "day boundary": the day tables over yesterday and today, as a pass just after midnight;
 *  - "fill <month>": every table over one whole month, one chunk of `fill-rollups`.
 *
 * ANALYZE executes each SELECT, so this reads what the pass would read: run it when the follower is
 * caught up, and expect the first run to read from disk and a second to hit the cache.
 *
 * Env: PGHOST/DATABASE_URL (required).
 */
import type { PoolClient } from "pg";
import { createPool } from "./pg-pool";
import { log, requirePostgres } from "./entrypoint";
import { ROLLUP_TABLES, type RollupGrain } from "./rollup/definitions";
import { monthEnd, monthStart } from "./rollup/pass";
import { bindSelect } from "./rollup/targets";

const DAY = 86_400;
const PAGE_MB = 8 / 1024;

interface PlanNode {
  "Node Type": string;
  "Relation Name"?: string;
  "Index Name"?: string;
  "Actual Rows"?: number;
  "Actual Total Time"?: number;
  "Shared Hit Blocks"?: number;
  "Shared Read Blocks"?: number;
  "Temp Written Blocks"?: number;
  Plans?: PlanNode[];
}

interface Explained {
  Plan: PlanNode;
  "Execution Time": number;
}

interface Shape {
  label: string;
  windows: Partial<Record<RollupGrain, [number, number]>>;
}

function arg(name: string): string[] {
  return process.argv.filter((a) => a.startsWith(`--${name}=`)).map((a) => a.split("=")[1] ?? "");
}

function printNodes(node: PlanNode, depth = 0): void {
  const on = node["Index Name"] ?? node["Relation Name"];
  log(
    `      ${"  ".repeat(depth)}${node["Node Type"]}${on ? ` on ${on}` : ""} ` +
      `rows=${node["Actual Rows"] ?? "?"} ms=${(node["Actual Total Time"] ?? 0).toFixed(1)}`,
  );
  for (const child of node.Plans ?? []) printNodes(child, depth + 1);
}

/** Every rollup name maps to itself: before the deploy the day views hold those names. */
async function relationsPresent(client: PoolClient): Promise<Set<string>> {
  const { rows } = await client.query<{ name: string }>(
    `SELECT n AS name FROM unnest($1::text[]) AS n WHERE to_regclass(n) IS NOT NULL`,
    [ROLLUP_TABLES.map((t) => t.name)],
  );
  return new Set(rows.map((r) => r.name));
}

async function main(): Promise<void> {
  requirePostgres();
  const plans = process.argv.includes("--plans");
  const timeout = Number(arg("timeout")[0] ?? 300);
  const pool = createPool(process.env.DATABASE_URL, { max: 1 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL TimeZone = 'UTC'");
    await client.query("SET LOCAL work_mem = '256MB'");
    await client.query(`SET LOCAL statement_timeout = '${Math.round(timeout)}s'`);

    const { rows } = await client.query<{ tip: string | null }>(
      "SELECT max(timestamp) AS tip FROM block",
    );
    if (rows[0]?.tip == null) throw new Error("no blocks");
    const tip = Number(rows[0].tip);
    const today = tip - (tip % DAY);
    const month = monthStart(tip);
    const shapes: Shape[] = [
      {
        label: "open day",
        windows: { day: [today, today + DAY], month: [month, monthEnd(month)], all: [0, 0] },
      },
      { label: "day boundary", windows: { day: [today - DAY, today + DAY] } },
      ...arg("month").map((m) => {
        const start = Date.parse(`${m}-01T00:00:00Z`) / 1000;
        if (!Number.isFinite(start)) throw new Error(`--month=${m} is not YYYY-MM`);
        const window: [number, number] = [start, monthEnd(start)];
        return { label: `fill ${m}`, windows: { day: window, month: window, all: window } };
      }),
    ];

    const present = await relationsPresent(client);
    const targets = new Map(ROLLUP_TABLES.map((t) => [t.name, t.name]));
    for (const shape of shapes) {
      log(`== ${shape.label}`);
      let total = 0;
      for (const table of ROLLUP_TABLES) {
        const window = shape.windows[table.grain];
        if (window === undefined) continue;
        const reads = [...table.select.matchAll(/\{([a-z_]+)\}|FROM (chain_[a-z_]+)/g)].map(
          (m) => m[1] ?? m[2] ?? "",
        );
        const absent = reads.filter((r) => !present.has(r));
        if (absent.length > 0) {
          log(`   ${table.name}: skipped — reads ${absent.join(", ")}, not created yet`);
          continue;
        }
        const params = table.grain === "all" ? [] : window;
        const { rows: out } = await client.query<{ "QUERY PLAN": Explained[] }>(
          `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${bindSelect(table.select, targets)}`,
          params,
        );
        const e = out[0]?.["QUERY PLAN"][0];
        if (e === undefined) continue;
        const p = e.Plan;
        total += e["Execution Time"];
        log(
          `   ${table.name}: ${e["Execution Time"].toFixed(0)}ms, ${p["Actual Rows"] ?? 0} rows, ` +
            `hit ${((p["Shared Hit Blocks"] ?? 0) * PAGE_MB).toFixed(1)}MB, ` +
            `read ${((p["Shared Read Blocks"] ?? 0) * PAGE_MB).toFixed(1)}MB, ` +
            `temp ${((p["Temp Written Blocks"] ?? 0) * PAGE_MB).toFixed(1)}MB`,
        );
        if (plans) printNodes(p);
      }
      log(`   total ${total.toFixed(0)}ms`);
    }
  } catch (error) {
    log(`FATAL ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    await pool.end();
  }
}

void main();
