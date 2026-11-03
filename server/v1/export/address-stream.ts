import { csvRecord } from "./csv";
import { cellText, tabulate, type ExportColumn, type SourceRow } from "./table";
import type { ExportFormat } from "./render";

/**
 * A walk written out as it is read, so memory holds one batch whatever the file's length.
 *
 * Pulled, never pushed: a batch is read only when the client has taken the previous one, so a slow
 * reader slows the walk instead of filling memory, and a gone one stops it. The stream errors
 * rather than ending early on any failure (a query, the deadline, more rows than the cap), so the
 * HTTP transfer ends without its final chunk and the client reports it incomplete: a short file
 * must never look like a whole one.
 *
 * The admission slot is released in the generator's `finally`, which runs only once an in-flight
 * query has settled, so the gate never admits a walk while a cancelled one still holds a
 * connection.
 */

export interface ExportStreamOptions {
  format: ExportFormat;
  columns: readonly ExportColumn[];
  /** The JSON form's fields ahead of `columns` and `rows`. */
  prefix: Record<string, unknown>;
  cap: number;
  deadlineMs: number;
  now: () => number;
  release: () => void;
  batches: (above: number) => Promise<{ rows: SourceRow[]; through: number; done: boolean }>;
}

const encoder = new TextEncoder();

/** A rest that ends early when the export is stopped. */
function rest(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted || ms <= 0) return resolve();
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}

export function streamExport(o: ExportStreamOptions): ReadableStream<Uint8Array> {
  const stop = new AbortController();
  let released = false;
  // Once, from whichever end comes first: the generator's `finally`, or a stop before it ever ran
  // (a generator that never started skips its `finally` on `return()`).
  const finish = () => {
    if (released) return;
    released = true;
    clearTimeout(deadline);
    o.release();
  };
  const columnsJson = o.columns.map(({ name, type, description, absent }) => ({
    name,
    type,
    description,
    empty: absent ?? [],
  }));

  async function* chunks(): AsyncGenerator<string> {
    try {
      yield o.format === "csv"
        ? csvRecord(o.columns.map((c) => c.name))
        : `${JSON.stringify({ ...o.prefix, columns: columnsJson }).slice(0, -1)},"rows":[`;
      const unknowns: Record<string, string> = {};
      let written = 0;
      let above = -1;
      for (;;) {
        if (stop.signal.aborted) throw new Error("export stopped");
        const started = o.now();
        const batch = await o.batches(above);
        if (written + batch.rows.length > o.cap) throw new Error("export passed its cap");
        const table = tabulate(o.columns, batch.rows);
        if (o.format === "csv") {
          yield table.rows.map((row) => csvRecord(row.map(cellText))).join("");
        } else if (table.rows.length > 0) {
          for (const [k, reason] of Object.entries(table.unknowns)) {
            const [, i, column] = k.split(".");
            unknowns[`rows.${written + Number(i)}.${column}`] = reason;
          }
          const objects = table.rows.map((row) =>
            JSON.stringify(Object.fromEntries(o.columns.map((c, i) => [c.name, row[i] ?? null]))),
          );
          yield `${written === 0 ? "" : ","}${objects.join(",")}`;
        }
        written += batch.rows.length;
        if (batch.done) break;
        above = batch.through;
        // As long again at rest as the batch took: half the connection's time at most, cold or warm.
        await rest(o.now() - started, stop.signal);
      }
      if (o.format === "json")
        yield `],"rowCount":${written},"unknowns":${JSON.stringify(unknowns)}}`;
    } finally {
      finish();
    }
  }

  const it = chunks();
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const halt = (reason: Error) => {
    stop.abort();
    try {
      controller?.error(reason);
    } catch {
      // Already closed or errored.
    }
    // Queued behind a pending step, so `finally` runs once its query settles.
    void it
      .return(undefined)
      .catch(() => undefined)
      .finally(finish);
  };
  const deadline = setTimeout(() => halt(new Error("export deadline passed")), o.deadlineMs);

  return new ReadableStream<Uint8Array>(
    {
      start(c) {
        controller = c;
      },
      async pull(c) {
        try {
          const step = await it.next();
          if (step.done) c.close();
          else c.enqueue(encoder.encode(step.value));
        } catch (error) {
          halt(error instanceof Error ? error : new Error(String(error)));
        }
      },
      cancel() {
        stop.abort();
        return it
          .return(undefined)
          .catch(() => undefined)
          .then(finish);
      },
    },
    { highWaterMark: 0 },
  );
}
