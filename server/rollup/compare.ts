import type { PoolClient } from "pg";
import type { RollupTable } from "./definitions";

/**
 * Row-for-row comparison of a rollup table with another source of the same rows: the materialized
 * view it replaces, or a definition evaluated live. Used by the production check, never by the
 * pass.
 */

type Query = Pick<PoolClient, "query">;

/**
 * `chain_day_network.avg_difficulty` is a float mean whose last bits depend on summation order,
 * and the view's order was its plan's. Equal within this relative tolerance counts as equal, and
 * the rows that are not bit-equal are counted separately.
 */
export const AVG_DIFFICULTY_TOLERANCE = 1e-12;

export interface RowDiff {
  /** Rows only in the left source, and only in the right (multiset difference). */
  onlyLeft: number;
  onlyRight: number;
  /** Period starts (unix seconds) whose rows differ; always empty for an all-time table. */
  periods: number[];
  /** Rows equal within `AVG_DIFFICULTY_TOLERANCE` but not bit-equal (`chain_day_network` only). */
  inexact: number;
}

/** A period key as the unix second its period starts. */
export function periodStartSql(table: RollupTable, alias = ""): string {
  const a = alias === "" ? "" : `${alias}.`;
  if (table.key === "ts") return `${a}ts`;
  if (table.key === "day") return `EXTRACT(EPOCH FROM ${a}day::timestamp)::bigint`;
  return "NULL::bigint";
}

/**
 * Compare two row sources for `table`, each a relation name or a parenthesised query yielding the
 * table's columns. Bind parameters, if any, are `params`.
 */
export async function diffRows(
  client: Query,
  table: RollupTable,
  left: string,
  right: string,
  params: readonly unknown[] = [],
): Promise<RowDiff> {
  const cols = table.columns.join(", ");
  if (table.name === "chain_day_network") return diffNetwork(client, left, right, params);
  const { rows } = await client.query<{ l: string; r: string; periods: string[] | null }>(
    `WITH lsrc AS (SELECT ${cols} FROM ${left} AS s),
          rsrc AS (SELECT ${cols} FROM ${right} AS s),
          l AS (SELECT * FROM lsrc EXCEPT ALL SELECT * FROM rsrc),
          r AS (SELECT * FROM rsrc EXCEPT ALL SELECT * FROM lsrc)
     SELECT (SELECT count(*) FROM l) AS l,
            (SELECT count(*) FROM r) AS r,
            ARRAY(SELECT DISTINCT ${periodStartSql(table, "x")}
                    FROM (SELECT * FROM l UNION ALL SELECT * FROM r) AS x
                   ORDER BY 1) AS periods`,
    [...params],
  );
  const row = rows[0];
  return {
    onlyLeft: Number(row?.l ?? 0),
    onlyRight: Number(row?.r ?? 0),
    periods: table.key === null ? [] : (row?.periods ?? []).map(Number),
    inexact: 0,
  };
}

async function diffNetwork(
  client: Query,
  left: string,
  right: string,
  params: readonly unknown[],
): Promise<RowDiff> {
  const { rows } = await client.query<{
    l: string;
    r: string;
    inexact: string;
    periods: string[] | null;
  }>(
    `WITH j AS (
       SELECT COALESCE(l.ts, r.ts) AS ts,
              l.ts IS NOT NULL AS in_l,
              r.ts IS NOT NULL AS in_r,
              (l.avg_block_bytes, l.blocks) IS NOT DISTINCT FROM (r.avg_block_bytes, r.blocks)
                AS rest_equal,
              l.avg_difficulty IS NOT DISTINCT FROM r.avg_difficulty AS bit_equal,
              COALESCE(abs(l.avg_difficulty - r.avg_difficulty)
                         <= $${params.length + 1}::float8
                            * greatest(abs(l.avg_difficulty), abs(r.avg_difficulty)), false)
                AS near_equal
         FROM (SELECT ts, avg_difficulty, avg_block_bytes, blocks FROM ${left} AS s) AS l
         FULL JOIN (SELECT ts, avg_difficulty, avg_block_bytes, blocks FROM ${right} AS s) AS r
           ON r.ts = l.ts
     ),
     d AS (
       SELECT *, in_l AND in_r AND rest_equal AND (bit_equal OR near_equal) AS same FROM j
     )
     SELECT count(*) FILTER (WHERE in_l AND NOT same)              AS l,
            count(*) FILTER (WHERE in_r AND NOT same)              AS r,
            count(*) FILTER (WHERE same AND NOT bit_equal)         AS inexact,
            ARRAY(SELECT ts FROM d WHERE NOT same ORDER BY ts)     AS periods
       FROM d`,
    [...params, AVG_DIFFICULTY_TOLERANCE],
  );
  const row = rows[0];
  return {
    onlyLeft: Number(row?.l ?? 0),
    onlyRight: Number(row?.r ?? 0),
    periods: (row?.periods ?? []).map(Number),
    inexact: Number(row?.inexact ?? 0),
  };
}

/** No row on either side differs. */
export const identical = (d: RowDiff) => d.onlyLeft === 0 && d.onlyRight === 0;
