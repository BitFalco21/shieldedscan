import type { ColumnSpec } from "../opendata/parquet";
import {
  ADDRESS_COLUMNS,
  BLOCK_COLUMNS,
  POOL_USAGE_DAILY_COLUMNS,
  SHIELDING_DAILY_COLUMNS,
  SHIELDING_RECORDS_DAILY_COLUMNS,
  TRANSACTION_COLUMNS,
  TRANSACTIONS_EXTRA_COLUMNS,
  TRANSPARENT_DAILY_COLUMNS,
  TRANSPARENT_IO_COLUMNS,
  TRANSPARENT_MONTHLY_COLUMNS,
} from "../opendata/tables";
import { copyLine } from "./copy";
import { RowCursor, rowGroups, type Value } from "./parquet-rows";
import type { ImportUnit } from "./plan";

/**
 * How each unit's files become rows of one table. Every published column lands in the database
 * column of the same name; what the dataset does not carry is either derived from a published
 * column by the same rule the follower applies (`is_coinbase` is `kind = 'coinbase'`), stamped
 * as the import's own observation (`computed_at`), or left NULL (`block.received_at`, our node's
 * receive time, which is not chain data). Nothing is filled with a stand-in value.
 */

/**
 * `blocks_coinbase/`, frozen with the exporter: one row per height, the same span as `blocks/`.
 * `coinbase_tag` is already the sanitised text the follower stored (`decodeCoinbaseTag`).
 */
export const BLOCKS_COINBASE_COLUMNS: readonly ColumnSpec[] = [
  { name: "height", type: "int32", nullable: false },
  { name: "miner_address", type: "utf8", nullable: true },
  { name: "coinbase_tag", type: "utf8", nullable: true },
];

/** The scratch table the published address snapshot is loaded into, for the final check only. */
export const ADDRESS_SNAPSHOT_TABLE = "selfhost_address_snapshot";

export interface UnitRows {
  table: string;
  columns: string[];
  lines: AsyncIterable<string>;
}

const names = (cols: readonly ColumnSpec[]) => cols.map((c) => c.name);
const pick = (cols: readonly ColumnSpec[], wanted: readonly string[]) =>
  cols.filter((c) => wanted.includes(c.name));

/**
 * Every row of `path` as COPY lines, the published columns then `extra()`, yielded one row group
 * at a time: a yield per row would cost an await per row, hundreds of millions of them.
 */
async function* plainRows(
  path: string,
  columns: readonly ColumnSpec[],
  extra: () => Value[] = () => [],
): AsyncGenerator<string> {
  for await (const g of rowGroups(path, columns)) {
    const lines: string[] = [];
    for (let i = 0; i < g.rows; i++) {
      lines.push(copyLine([...columns.map((c) => g.get(c.name, i)), ...extra()]));
    }
    yield lines.join("");
  }
}

/** Rows of a primary file, each joined with its companion's next row, which must carry its key; per row group like `plainRows`. */
async function* alignedRows(
  primary: string,
  columns: readonly ColumnSpec[],
  key: string,
  companion: RowCursor | null,
  companionKey: string,
  companionColumns: readonly string[],
  derived: (get: (c: string) => Value) => Value[],
): AsyncGenerator<string> {
  try {
    for await (const g of rowGroups(primary, columns)) {
      const lines: string[] = [];
      for (let i = 0; i < g.rows; i++) {
        const get = (c: string) => g.get(c, i);
        const values: Value[] = [...columns.map((c) => get(c.name)), ...derived(get)];
        if (companion) {
          if (!(await companion.next())) throw new Error(`${primary}: its companion ends early`);
          if (companion.get(companionKey) !== get(key)) {
            throw new Error(
              `${primary}: companion row ${String(companion.get(companionKey))} where ${String(get(key))} was expected`,
            );
          }
          values.push(...companionColumns.map((c) => companion.get(c)));
        }
        lines.push(copyLine(values));
      }
      yield lines.join("");
    }
    if (companion && (await companion.next())) {
      throw new Error(`${primary}: its companion has extra rows`);
    }
  } finally {
    await companion?.close();
  }
}

/** The rows one unit puts in its table; `paths` are the unit's local files, in its order. */
export function unitRows(unit: ImportUnit, paths: readonly string[], nowSec: number): UnitRows {
  const [primary, ...companions] = paths;
  if (primary === undefined) throw new Error(`${unit.key}: no files`);
  const stamp = () => [nowSec];
  switch (unit.kind) {
    case "blocks": {
      const cursor = companions.length ? new RowCursor(companions, BLOCKS_COINBASE_COLUMNS) : null;
      const extra = cursor ? ["miner_address", "coinbase_tag"] : [];
      return {
        table: "block",
        columns: [...names(BLOCK_COLUMNS), ...extra],
        lines: alignedRows(primary, BLOCK_COLUMNS, "height", cursor, "height", extra, () => []),
      };
    }
    case "transactions": {
      const extraColumns = pick(TRANSACTIONS_EXTRA_COLUMNS, ["txid", "binding_sig_valid"]);
      return {
        table: "tx",
        columns: [...names(TRANSACTION_COLUMNS), "is_coinbase", "binding_sig_valid"],
        lines: alignedRows(
          primary,
          TRANSACTION_COLUMNS,
          "txid",
          new RowCursor(companions, extraColumns),
          "txid",
          ["binding_sig_valid"],
          (get) => [get("kind") === "coinbase"],
        ),
      };
    }
    case "transparent_io":
      return {
        table: "tx_transparent_io",
        columns: names(TRANSPARENT_IO_COLUMNS),
        lines: plainRows(primary, TRANSPARENT_IO_COLUMNS),
      };
    case "pool_usage_daily":
      return {
        table: "pool_usage_daily",
        columns: [...names(POOL_USAGE_DAILY_COLUMNS), "computed_at"],
        lines: plainRows(primary, POOL_USAGE_DAILY_COLUMNS, stamp),
      };
    case "transparent_daily":
      return {
        table: "transparent_daily",
        columns: [...names(TRANSPARENT_DAILY_COLUMNS), "computed_at"],
        lines: plainRows(primary, TRANSPARENT_DAILY_COLUMNS, stamp),
      };
    case "transparent_monthly":
      // The release publishes complete months only (`complete AND` its last day final).
      return {
        table: "transparent_monthly",
        columns: [...names(TRANSPARENT_MONTHLY_COLUMNS), "complete", "computed_at"],
        lines: plainRows(primary, TRANSPARENT_MONTHLY_COLUMNS, () => [true, nowSec]),
      };
    case "boundary_daily":
      return boundaryRows(primary, companions[0], nowSec);
    case "addresses":
      return {
        table: ADDRESS_SNAPSHOT_TABLE,
        columns: names(ADDRESS_COLUMNS),
        lines: plainRows(primary, ADDRESS_COLUMNS),
      };
  }
}

/**
 * `boundary_daily` is published as two tables of the same days (both read from it): the counts
 * (`shielding_daily`) and the day's records (`shielding_records_daily`). Joined back on the day,
 * and the two must hold the same days. A few thousand rows, so both are read whole.
 */
function boundaryRows(counts: string, records: string | undefined, nowSec: number): UnitRows {
  if (records === undefined) throw new Error("boundary_daily needs shielding_records_daily");
  const recordColumns = SHIELDING_RECORDS_DAILY_COLUMNS.filter((c) => c.name !== "day");
  async function* lines(): AsyncGenerator<string> {
    const byDay = new Map<string, Value[]>();
    for await (const g of rowGroups(records!, SHIELDING_RECORDS_DAILY_COLUMNS)) {
      for (let i = 0; i < g.rows; i++) {
        byDay.set(
          String(g.get("day", i)),
          recordColumns.map((c) => g.get(c.name, i)),
        );
      }
    }
    for await (const g of rowGroups(counts, SHIELDING_DAILY_COLUMNS)) {
      for (let i = 0; i < g.rows; i++) {
        const day = String(g.get("day", i));
        const rec = byDay.get(day);
        if (!rec) throw new Error(`shielding_records_daily has no row for ${day}`);
        byDay.delete(day);
        yield copyLine([...SHIELDING_DAILY_COLUMNS.map((c) => g.get(c.name, i)), ...rec, nowSec]);
      }
    }
    if (byDay.size > 0) throw new Error(`shielding_daily has no row for ${[...byDay.keys()][0]}`);
  }
  return {
    table: "boundary_daily",
    columns: [...names(SHIELDING_DAILY_COLUMNS), ...names(recordColumns), "computed_at"],
    lines: lines(),
  };
}
