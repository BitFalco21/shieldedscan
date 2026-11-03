import type { Context, Next } from "hono";
import { matchedRoutes } from "hono/route";
import { errorBody, setCache } from "../http";
import { at, tabulate } from "./table";
import { columnsOf, type ExportSpec } from "./spec";
import { EXPORTS, SELF_FORMATTED } from "./registry";
import {
  CROSSCHAIN_EXPORT_ENABLED,
  CROSSCHAIN_EXPORT_REFUSAL,
  CROSSCHAIN_PREFIX,
  EXPORT_PARAM,
} from "./policy";
import {
  CONTENT_TYPE,
  EXPORT_FORMATS,
  type ExportFormat,
  fileName,
  provenanceHeaders,
  publicUrl,
  tableCsv,
  tableJson,
} from "./render";

/**
 * `format=csv|json` on every `/v1` route, in one place in front of them.
 *
 * The route runs exactly as without `format`: the same parameter checks, the same memo, cache or
 * admission gate, the same Cache-Control. A 200 is then read back and written out as its declared
 * table. So an export costs what the JSON answer costs, plus re-serialising at most a page or a
 * series in this process, and never a query of its own.
 *
 * Registered after `etag` in the `/v1` stack, so on the way out the table is written first and the
 * ETag is the file's. Every route's parameter check lets `format` through because this layer has
 * answered it before the route runs: a file, or a 400 saying why not.
 */

/** Defaults are the registry and the policy switch; tests inject their own. */
export interface ExportLayerOptions {
  exports?: Readonly<Record<string, ExportSpec>>;
  crosschainEnabled?: boolean;
}

/** The GET route a request matched, past the `/v1/*` middleware; null when only middleware did. */
function routePattern(c: Context): string | null {
  const route = matchedRoutes(c).find((r) => r.method !== "ALL");
  return route?.path ?? null;
}

const refuse = (c: Context, code: "invalid_parameter" | "not_exportable", message: string) => {
  setCache(c, "rejection");
  return c.json(errorBody(c, code, message), 400);
};

export function exportLayer(opts: ExportLayerOptions = {}) {
  const exports = opts.exports ?? EXPORTS;
  const crosschainEnabled = opts.crosschainEnabled ?? CROSSCHAIN_EXPORT_ENABLED;
  return async (c: Context, next: Next) => {
    const asked = c.req.queries(EXPORT_PARAM);
    if (asked === undefined) return next();
    const pattern = routePattern(c);
    // An unknown path stays a 404, and a route with its own `format` keeps its meaning.
    if (pattern === null || SELF_FORMATTED.has(pattern)) return next();
    const format = asked.length === 1 ? asked[0] : undefined;
    if (!(EXPORT_FORMATS as readonly (string | undefined)[]).includes(format)) {
      return refuse(c, "invalid_parameter", "format: csv | json, once");
    }
    if (pattern.startsWith(CROSSCHAIN_PREFIX) && !crosschainEnabled) {
      return refuse(c, "not_exportable", CROSSCHAIN_EXPORT_REFUSAL);
    }
    const spec = exports[pattern];
    if (!spec) {
      return refuse(
        c,
        "invalid_parameter",
        "format is not offered on this endpoint; GET /v1 lists the endpoints that export",
      );
    }
    // `fields` trims the answer the table is read from; a file always has all its columns.
    if (c.req.query("fields") !== undefined) {
      return refuse(c, "invalid_parameter", "fields cannot be combined with format");
    }
    await next();
    if (c.res.status !== 200) return;
    const body: unknown = await c.res.json();
    await writeExport(c, spec, body, format as ExportFormat);
  };
}

async function writeExport(c: Context, spec: ExportSpec, body: unknown, format: ExportFormat) {
  const table = tabulate(columnsOf(spec, body), spec.rows(body));
  const stated = spec.provenance?.(body) ?? {};
  const asOf = at(body, "asOf");
  const provenance = {
    request: publicUrl(c.req.url),
    height: stated.height ?? null,
    through: stated.through ?? null,
    asOf: typeof asOf === "number" ? asOf : null,
  };
  const headers = new Headers(c.res.headers);
  headers.delete("content-length");
  headers.set("Content-Type", CONTENT_TYPE[format]);
  // A CSV is saved; the JSON form is read in place (a browser tab, an assistant's preview).
  headers.set(
    "Content-Disposition",
    `${format === "csv" ? "attachment" : "inline"}; filename="${fileName(spec.dataset, c.req.url, format)}"`,
  );
  for (const [k, v] of Object.entries(provenanceHeaders(provenance))) headers.set(k, v);
  // A partial answer says so in the file's headers too; its notes are in the JSON form.
  const coverage = at(body, "coverage.status");
  if (typeof coverage === "string") headers.set("X-Coverage", coverage);
  const truncated = spec.truncated?.(body) ?? false;
  if (truncated) headers.set("X-Truncated", "true");
  const next = spec.paged ? nextPageUrl(c.req.url, at(body, "nextCursor")) : null;
  if (next !== null) headers.set("Link", `<${next}>; rel="next"`);
  const text =
    format === "csv"
      ? tableCsv(table)
      : JSON.stringify(
          tableJson(spec.dataset, table, provenance, {
            query: at(body, "query") ?? null,
            source: at(body, "source") ?? null,
            basis: at(body, "basis") ?? null,
            coverage: at(body, "coverage") ?? null,
            ...(spec.paged ? { nextCursor: at(body, "nextCursor") ?? null } : {}),
            ...(spec.truncated ? { truncated } : {}),
          }),
        );
  // Hono's setter lays the previous response's headers over a new one; clearing it first keeps
  // these.
  c.res = undefined;
  c.res = new Response(text, { status: 200, headers });
}

/** The next page as a public URL: the same request, paged forward with `cursor`. */
function nextPageUrl(requestUrl: string, cursor: unknown): string | null {
  if (typeof cursor !== "string" || cursor === "") return null;
  const u = new URL(requestUrl);
  u.searchParams.delete("before");
  u.searchParams.delete("after");
  u.searchParams.set("cursor", cursor);
  return publicUrl(u.toString());
}
