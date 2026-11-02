import { openAsBlob } from "node:fs";
import { tableFromIPC, type Table } from "apache-arrow";
import { ParquetFile } from "parquet-wasm";
import type { ColumnSpec } from "../opendata/parquet";

/**
 * A release file read one row group at a time (100,000 rows, `ROWS_PER_GROUP`), straight from
 * disk: memory is bounded by a row group, never by a file. Values come back as the exporter wrote
 * them: int64 as BigInt (an amount never passes through a float), a date as `YYYY-MM-DD`, a NULL
 * as null.
 */

export type Value = number | bigint | string | boolean | null;

const DAY_MS = 86_400_000;

/** One row group's columns, read by name and row index. */
export class RowGroup {
  readonly rows: number;
  readonly #getters = new Map<string, (i: number) => Value>();

  constructor(table: Table, columns: readonly ColumnSpec[]) {
    this.rows = table.numRows;
    for (const c of columns) {
      const v = table.getChild(c.name);
      if (!v) throw new Error(`column ${c.name} is missing`);
      const raw = (i: number) => v.get(i) as Value | Date | undefined;
      this.#getters.set(
        c.name,
        c.type === "date"
          ? // Date32 reads back as epoch milliseconds; the day is pure arithmetic, no timezone.
            (i) => {
              const ms = raw(i);
              if (ms == null) return null;
              const n = ms instanceof Date ? ms.getTime() : Number(ms);
              return new Date(Math.floor(n / DAY_MS) * DAY_MS).toISOString().slice(0, 10);
            }
          : (i) => (raw(i) ?? null) as Value,
      );
    }
  }

  get(column: string, i: number): Value {
    const g = this.#getters.get(column);
    if (!g) throw new Error(`column ${column} was not requested`);
    return g(i);
  }
}

/** Every row group of one file, in order; the file's columns are checked against `columns`. */
export async function* rowGroups(
  path: string,
  columns: readonly ColumnSpec[],
): AsyncGenerator<RowGroup> {
  const file = await ParquetFile.fromFile(await openAsBlob(path));
  try {
    const schema = file.schema();
    const missing = columns.filter((c) => schema.indexOf(c.name) < 0).map((c) => c.name);
    schema.free();
    if (missing.length > 0) throw new Error(`${path}: columns missing: ${missing.join(", ")}`);
    const groups = file.metadata().numRowGroups();
    for (let g = 0; g < groups; g++) {
      const wasm = await file.read({ rowGroups: [g], columns: columns.map((c) => c.name) });
      yield new RowGroup(tableFromIPC(wasm.intoIPCStream()), columns);
    }
  } finally {
    file.free();
  }
}

/**
 * Rows of several files read as one sequence, row by row: the companion of a primary file whose
 * rows align with it one to one (`transactions_extra` beside `transactions`, `blocks_coinbase`
 * beside `blocks`).
 */
export class RowCursor {
  #files: string[];
  #groups: AsyncGenerator<RowGroup> | null = null;
  #group: RowGroup | null = null;
  #i = -1;

  constructor(
    paths: readonly string[],
    private readonly columns: readonly ColumnSpec[],
  ) {
    this.#files = [...paths];
  }

  /** Moves to the next row; false when every file is exhausted. */
  async next(): Promise<boolean> {
    for (;;) {
      if (this.#group && this.#i + 1 < this.#group.rows) {
        this.#i++;
        return true;
      }
      if (this.#groups) {
        const g = await this.#groups.next();
        if (!g.done) {
          this.#group = g.value;
          this.#i = -1;
          continue;
        }
      }
      const path = this.#files.shift();
      if (path === undefined) return false;
      this.#groups = rowGroups(path, this.columns);
      this.#group = null;
    }
  }

  /** Releases the open file; safe to call at any point. */
  async close(): Promise<void> {
    await this.#groups?.return(undefined);
    this.#files = [];
  }

  get(column: string): Value {
    if (!this.#group || this.#i < 0) throw new Error("the cursor is not on a row");
    return this.#group.get(column, this.#i);
  }
}
