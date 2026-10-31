import {
  Bool,
  DateDay,
  Field,
  Float64,
  Int32,
  Int64,
  makeData,
  RecordBatch,
  Schema,
  Struct,
  Table,
  tableToIPC,
  Utf8,
  type DataType,
} from "apache-arrow";
import {
  Compression,
  EnabledStatistics,
  Table as WasmTable,
  WriterPropertiesBuilder,
  WriterVersion,
  writeParquet,
} from "parquet-wasm";

/**
 * Columns to Parquet bytes, built by hand from typed arrays so nothing between the database and
 * the file can turn a value into something else: a 64-bit amount stays a BigInt end to end, a NULL
 * is a cleared validity bit (never 0), and a date is a count of days computed from its string.
 *
 * The same rows always give the same bytes: one record batch per `ROWS_PER_GROUP` rows, every
 * writer property set explicitly, and the library versions pinned. A golden-file test notices a
 * library bump that changes the bytes.
 */

export type ColumnType = "int32" | "int64" | "float64" | "utf8" | "bool" | "date";

export interface ColumnSpec {
  name: string;
  type: ColumnType;
  nullable: boolean;
}

/** A column's values in row order: numbers, BigInts, strings, booleans or `YYYY-MM-DD`, or null. */
export type ColumnValues = readonly (number | bigint | string | boolean | null)[];

/** Rows per row group, and per record batch, so group boundaries never depend on how rows were read. */
export const ROWS_PER_GROUP = 100_000;

const CREATED_BY = "shieldedscan open data";

const DAY_MS = 86_400_000;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Days since 1970-01-01 for a `YYYY-MM-DD` string, by arithmetic: no timezone can shift it. */
export function epochDay(date: string): number {
  const m = DATE.exec(date);
  if (!m) throw new Error(`not a date: ${JSON.stringify(date)}`);
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const day = ms / DAY_MS;
  if (!Number.isInteger(day) || new Date(ms).toISOString().slice(0, 10) !== date) {
    throw new Error(`not a calendar date: ${date}`);
  }
  return day;
}

function arrowType(type: ColumnType): DataType {
  switch (type) {
    case "int32":
      return new Int32();
    case "int64":
      return new Int64();
    case "float64":
      return new Float64();
    case "utf8":
      return new Utf8();
    case "bool":
      return new Bool();
    case "date":
      return new DateDay();
  }
}

function validity(values: ColumnValues, column: ColumnSpec): { bitmap: Uint8Array; nulls: number } {
  const bitmap = new Uint8Array((values.length + 7) >> 3);
  let nulls = 0;
  values.forEach((v, i) => {
    if (v === null) {
      if (!column.nullable) throw new Error(`${column.name}: NULL in a non-null column (row ${i})`);
      nulls++;
    } else bitmap[i >> 3]! |= 1 << (i & 7);
  });
  return { bitmap, nulls };
}

function expect<T>(v: unknown, ok: (v: unknown) => v is T, column: string, want: string): T {
  if (!ok(v)) throw new Error(`${column}: expected ${want}, got ${typeof v}`);
  return v;
}

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);
const isBig = (v: unknown): v is bigint => typeof v === "bigint";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isBool = (v: unknown): v is boolean => typeof v === "boolean";

const INT32_MIN = -(2 ** 31);
const INT32_MAX = 2 ** 31 - 1;
const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;

/** One column slice as Arrow data, with its types checked value by value. */
function columnData(values: ColumnValues, column: ColumnSpec) {
  const { bitmap, nulls } = validity(values, column);
  const type = arrowType(column.type);
  const nullBitmap = nulls > 0 ? bitmap : undefined;
  const length = values.length;
  switch (column.type) {
    case "int32": {
      const data = new Int32Array(length);
      values.forEach((v, i) => {
        if (v === null) return;
        const n = expect(v, isInt, column.name, "an integer");
        if (n < INT32_MIN || n > INT32_MAX) throw new Error(`${column.name}: ${n} overflows int32`);
        data[i] = n;
      });
      return makeData({ type: type as Int32, length, nullCount: nulls, nullBitmap, data });
    }
    case "int64": {
      const data = new BigInt64Array(length);
      values.forEach((v, i) => {
        if (v === null) return;
        const n = expect(v, isBig, column.name, "a BigInt");
        if (n < INT64_MIN || n > INT64_MAX) throw new Error(`${column.name}: ${n} overflows int64`);
        data[i] = n;
      });
      return makeData({ type: type as Int64, length, nullCount: nulls, nullBitmap, data });
    }
    case "float64": {
      const data = new Float64Array(length);
      values.forEach((v, i) => {
        if (v !== null) data[i] = expect(v, isNum, column.name, "a finite number");
      });
      return makeData({ type: type as Float64, length, nullCount: nulls, nullBitmap, data });
    }
    case "bool": {
      const data = new Uint8Array((length + 7) >> 3);
      values.forEach((v, i) => {
        if (v !== null && expect(v, isBool, column.name, "a boolean"))
          data[i >> 3]! |= 1 << (i & 7);
      });
      return makeData({ type: type as Bool, length, nullCount: nulls, nullBitmap, data });
    }
    case "date": {
      const data = new Int32Array(length);
      values.forEach((v, i) => {
        if (v !== null) data[i] = epochDay(expect(v, isStr, column.name, "a YYYY-MM-DD string"));
      });
      return makeData({ type: type as DateDay, length, nullCount: nulls, nullBitmap, data });
    }
    case "utf8": {
      const encoder = new TextEncoder();
      const parts = values.map((v) =>
        v === null ? new Uint8Array(0) : encoder.encode(expect(v, isStr, column.name, "a string")),
      );
      const valueOffsets = new Int32Array(length + 1);
      parts.forEach((p, i) => (valueOffsets[i + 1] = valueOffsets[i]! + p.length));
      const data = new Uint8Array(valueOffsets[length]!);
      parts.forEach((p, i) => data.set(p, valueOffsets[i]!));
      return makeData({
        type: type as Utf8,
        length,
        nullCount: nulls,
        nullBitmap,
        valueOffsets,
        data,
      });
    }
  }
}

/** The Arrow schema for a table's columns, in order. */
export function arrowSchema(columns: readonly ColumnSpec[]): Schema {
  return new Schema(columns.map((c) => new Field(c.name, arrowType(c.type), c.nullable)));
}

/** An Arrow table from columns of equal length, one record batch per `ROWS_PER_GROUP` rows. */
export function arrowTable(columns: readonly ColumnSpec[], values: readonly ColumnValues[]): Table {
  if (values.length !== columns.length) throw new Error("one value array per column");
  const rows = values[0]?.length ?? 0;
  values.forEach((v, i) => {
    if (v.length !== rows)
      throw new Error(`${columns[i]!.name}: ${v.length} values, expected ${rows}`);
  });
  const schema = arrowSchema(columns);
  const batch = (start: number, end: number) =>
    new RecordBatch(
      schema,
      makeData({
        type: new Struct(schema.fields),
        length: end - start,
        nullCount: 0,
        children: columns.map((c, i) => columnData(values[i]!.slice(start, end), c)),
      }),
    );
  // An empty table still carries its schema, as one empty batch.
  const batches = [batch(0, Math.min(rows, ROWS_PER_GROUP))];
  for (let start = ROWS_PER_GROUP; start < rows; start += ROWS_PER_GROUP) {
    batches.push(batch(start, Math.min(rows, start + ROWS_PER_GROUP)));
  }
  return new Table(schema, batches);
}

/** Every writer property set explicitly, so a library default changing cannot change a file. */
function writerProperties() {
  return new WriterPropertiesBuilder()
    .setCreatedBy(CREATED_BY)
    .setWriterVersion(WriterVersion.V1)
    .setCompression(Compression.ZSTD)
    .setDictionaryEnabled(false)
    .setStatisticsEnabled(EnabledStatistics.Chunk)
    .setMaxRowGroupSize(ROWS_PER_GROUP)
    .setDataPageSizeLimit(1024 * 1024)
    .setWriteBatchSize(1024)
    .build();
}

/** Parquet bytes for an Arrow table. */
export function toParquet(table: Table): Uint8Array {
  return writeParquet(WasmTable.fromIPCStream(tableToIPC(table, "stream")), writerProperties());
}
