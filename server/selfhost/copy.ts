import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { PoolClient } from "pg";
// pg-copy-streams: streaming `COPY ... FROM STDIN`, which `pg` alone cannot do. COPY is the only
// way to load hundreds of millions of rows in hours rather than days; batched INSERTs parse and
// plan every statement.
import { from as copyFrom } from "pg-copy-streams";
import type { Value } from "./parquet-rows";

/**
 * Rows into a table with `COPY ... FROM STDIN` in text format, streamed with backpressure: the
 * rows are produced as COPY consumes them, so memory holds one buffer, not a file.
 */

/** Bytes per write: large enough to amortise the stream's per-chunk cost. */
const BUFFER = 1 << 20;

/** One field in COPY's text format; NULL is `\N`, and the four special characters are escaped. */
export function copyField(v: Value): string {
  if (v === null) return "\\N";
  if (typeof v === "boolean") return v ? "t" : "f";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error(`not a finite number: ${v}`);
    return String(v);
  }
  if (typeof v === "bigint") return v.toString();
  return v.replace(/[\\\t\n\r]/g, (c) =>
    c === "\\" ? "\\\\" : c === "\t" ? "\\t" : c === "\n" ? "\\n" : "\\r",
  );
}

export function copyLine(values: readonly Value[]): string {
  return values.map(copyField).join("\t") + "\n";
}

/** Groups lines into large chunks, so the stream sees a few writes per row group, not one per row. */
async function* buffered(lines: AsyncIterable<string>): AsyncGenerator<string> {
  let buf = "";
  for await (const line of lines) {
    buf += line;
    if (buf.length >= BUFFER) {
      yield buf;
      buf = "";
    }
  }
  if (buf.length > 0) yield buf;
}

/** Copies `lines` into `table (columns)` on `client`; returns the rows Postgres reports. */
export async function copyInto(
  client: PoolClient,
  table: string,
  columns: readonly string[],
  lines: AsyncIterable<string>,
): Promise<number> {
  const ident = (s: string) => {
    if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`not a plain identifier: ${s}`);
    return s;
  };
  const sink = client.query(
    copyFrom(`COPY ${ident(table)} (${columns.map(ident).join(", ")}) FROM STDIN`),
  );
  await pipeline(Readable.from(buffered(lines)), sink);
  return sink.rowCount;
}
