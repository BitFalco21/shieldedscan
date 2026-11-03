import { createHash } from "node:crypto";
import { Hono, type Context } from "hono";
import type { Pool } from "pg";
import { classifyZcashAddress } from "@/domain";
import { MAINNET_SITE_URL as SITE } from "@/lib/network";
import { AdmissionGate } from "../../admission-gate";
import { lifetimeTxCount } from "../../address-counts";
import { errorBody, routeGroupErrors, setCache } from "../http";
import { ParamError, rejectUnknown } from "../params";
import { readAddressBatch } from "./address-walk";
import { ADDRESS_EXPORT_COLUMNS, addressRowSource } from "./address-columns";
import { addressAlternative } from "./open-dataset";
import { EXPORT_PARAM } from "./policy";
import {
  CONTENT_TYPE,
  EXPORT_FORMATS,
  type ExportFormat,
  provenanceHeaders,
  publicUrl,
} from "./render";
import { streamExport } from "./address-stream";

/**
 * `/v1/addresses/{address}/export`: one transparent address's whole history as a file.
 *
 * The only export that reads more than an answer already built, so it is bounded on every side:
 *  - a cap, checked against the address's exact lifetime count BEFORE any walk; past it, a 422
 *    naming the count and pointing to the open dataset with a ready query;
 *  - the cheap checks (tip, count, ETag) on the core `/v1` pool, the walk on connections of its
 *    own, so a crowd of refusals never queues behind a running export;
 *  - an admission gate: one export runs, four wait up to five seconds, the rest get a 503 before
 *    touching the database. One, because each walk is random reads on the disk ingestion writes
 *    to; raise it only after watching the disk under real exports;
 *  - batches of index rows, each one statement, resting as long as it took between them, so an
 *    export uses at most half of its connection's time;
 *  - a total deadline, which also bounds a client too slow to read;
 *  - Caddy's `v1_address_export` zones, per IP and overall.
 */

export const V1_ADDRESS_EXPORT_PATH = "/v1/addresses/{address}/export";
export const ADDRESS_EXPORT_PATTERN = "/v1/addresses/:address/export";
/** The Caddy matcher, kept beside the route so a test can hold the two together. */
export const V1_ADDRESS_EXPORT_REGEXP = "^/v1/addresses/[^/]+/export$";

/**
 * Transactions one file may hold. Measured on a 4.5M-row synthetic ledger: an export touches about
 * 2.8 pages per transaction (one heap page per index row, then the transaction by primary key),
 * about 1.5 of them outside Postgres' cache. At production's ~0.2 ms per cold page, 10,000
 * transactions is ~6 s of reads, ~12 s with the rests between batches: inside the deadline, and
 * the busiest addresses (millions of rows) are the open dataset's job.
 */
export const ADDRESS_EXPORT_CAP = 10_000;

/** Exports walking at once. See the header. */
export const ADDRESS_EXPORTS_AT_ONCE = 1;

/**
 * The file's shape, in its ETag: a release that changes the columns must not answer a client's
 * old file with a 304.
 */
const SCHEMA = ADDRESS_EXPORT_COLUMNS.map((c) => c.name).join(",");

export interface AddressExportDeps {
  /** The core `/v1` pool: the tip and the count, never the walk. */
  pool: Pool;
  /** The walk's own connections. */
  walkPool: Pool;
  cap?: number;
  gate?: AdmissionGate;
  deadlineMs?: number;
  now?: () => number;
  /** Injectable so the contract is testable without a database. */
  tip?: (pool: Pool) => Promise<IndexTip | null>;
  count?: (pool: Pool, address: string) => Promise<number | null>;
  readBatch?: typeof readAddressBatch;
}

export interface IndexTip {
  height: number;
  hash: string;
  /** The block header's time, unix seconds. */
  timestamp: number;
}

/** The newest block the index holds: the walk stops there and the file says so. */
async function indexTip(pool: Pool): Promise<IndexTip | null> {
  const { rows } = await pool.query<IndexTip>(
    "SELECT height, hash, timestamp FROM block ORDER BY height DESC LIMIT 1",
  );
  return rows[0] ?? null;
}

function parseFormat(c: Context): ExportFormat {
  const asked = c.req.queries(EXPORT_PARAM) ?? ["csv"];
  const format = asked.length === 1 ? asked[0] : undefined;
  if (!(EXPORT_FORMATS as readonly (string | undefined)[]).includes(format)) {
    throw new ParamError("invalid_parameter", "format: csv | json, once", "rejection");
  }
  return format as ExportFormat;
}

function transparentAddress(c: Context): string {
  const raw = c.req.param("address") ?? "";
  const kind = classifyZcashAddress(raw);
  if (kind === "transparent") return raw.trim();
  throw new ParamError(
    "invalid_parameter",
    kind === null
      ? "address is not a Zcash address"
      : "a shielded address has no public history: its transactions are encrypted on-chain by design",
    "rejection",
  );
}

export function v1AddressExportRoutes(deps: AddressExportDeps): Hono {
  const app = new Hono();
  const cap = deps.cap ?? ADDRESS_EXPORT_CAP;
  const gate = deps.gate ?? new AdmissionGate(ADDRESS_EXPORTS_AT_ONCE, 4, 5_000);
  const now = deps.now ?? Date.now;
  const tipOf = deps.tip ?? indexTip;
  const countOf = deps.count ?? lifetimeTxCount;

  app.onError(routeGroupErrors("the address index could not answer just now; retry shortly"));

  app.get(ADDRESS_EXPORT_PATTERN, async (c) => {
    rejectUnknown(c.req.query(), []);
    const format = parseFormat(c);
    const address = transparentAddress(c);
    const tip = await tipOf(deps.pool);
    if (tip === null) {
      return c.json(errorBody(c, "upstream_unavailable", "the chain index is empty"), 503);
    }
    // The file is fixed by its shape, the address and the chain it was read from: a new block or
    // a reorg changes the tip's hash, and with it the tag.
    const etag = `W/"${createHash("sha1").update(`${SCHEMA}|${address}|${format}|${tip.hash}`).digest("hex")}"`;
    const asOf = Math.floor(now() / 1000);
    const request = publicUrl(c.req.url);
    const headers: Record<string, string> = {
      "Content-Type": CONTENT_TYPE[format],
      "Content-Disposition": `${format === "csv" ? "attachment" : "inline"}; filename="shieldedscan_address_${address}.${format}"`,
      ETag: etag,
      ...provenanceHeaders({
        request,
        height: tip.height,
        through: new Date(tip.timestamp * 1000).toISOString().replace(".000Z", "Z"),
        asOf,
      }),
    };
    const inm = c.req.header("If-None-Match");
    if (
      inm !== undefined &&
      inm.split(",").some((t) => t.trim().replace(/^W\//, "") === etag.slice(2))
    ) {
      setCache(c, "listHead");
      return c.body(null, 304, { ETag: etag });
    }

    // Before HEAD too, so a HEAD answers what a GET would: three primary-key reads at most.
    const count = await countOf(deps.pool, address);
    if (count === null || count > cap) {
      const tooLarge = count !== null;
      // A refusal stands for a minute; an outage of ours is never cached.
      if (tooLarge) setCache(c, "rejection");
      else c.header("Retry-After", "60");
      return c.json(
        {
          ...errorBody(
            c,
            tooLarge ? "export_too_large" : "upstream_unavailable",
            tooLarge
              ? `this address has ${count.toLocaleString("en-US")} transactions; an export holds at most ${cap.toLocaleString("en-US")}. The open dataset has every one: run the query in alternative.duckdb`
              : "this address's transaction count cannot be read right now, so the export cannot be bounded; retry later, or use the open dataset",
            asOf,
          ),
          count,
          cap,
          alternative: addressAlternative(address),
        },
        tooLarge ? 422 : 503,
      );
    }
    // A HEAD's body is dropped unread, so no slot and no walk may start for it.
    if (c.req.method === "HEAD") {
      setCache(c, "listHead");
      return c.body(null, 200, headers);
    }
    const admitted = await gate.acquire(c.req.raw.signal);
    if (admitted !== "admitted") {
      c.header("Retry-After", "10");
      return c.json(
        errorBody(c, "upstream_unavailable", "busy: address exports are running; retry shortly"),
        503,
      );
    }
    setCache(c, "listHead");
    const stream = streamExport({
      format,
      columns: ADDRESS_EXPORT_COLUMNS,
      prefix: {
        dataset: "address-transactions-history",
        request,
        query: { address },
        source: { name: "ShieldedScan", url: `${SITE}/address/${address}` },
        basis:
          "every transaction that pays this transparent address or spends from it, oldest first, through the block in dataHeight. Transparent value only: a shielded amount has no address to file under.",
        dataHeight: tip.height,
        transactions: count,
        asOf,
      },
      cap,
      deadlineMs: deps.deadlineMs ?? 60_000,
      now,
      release: () => gate.release(),
      batches: (above) =>
        (deps.readBatch ?? readAddressBatch)(deps.walkPool, address, above, tip.height).then(
          (b) => ({ ...b, rows: b.rows.map(addressRowSource) }),
        ),
    });
    return c.body(stream, 200, headers);
  });

  return app;
}
