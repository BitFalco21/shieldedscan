import type { ApiGroup, ApiParam } from "./types";

/**
 * The endpoints that answer `format=csv|json`. The server's export registry is the source; a test
 * holds this list to it, so the docs never offer a file the API refuses.
 */
export const EXPORTABLE_PATHS: readonly string[] = [
  "/v1/analytics/pools",
  "/v1/analytics/pool-usage",
  "/v1/analytics/network",
  "/v1/analytics/fees",
  "/v1/analytics/transparent",
  "/v1/analytics/monthly",
  "/v1/analytics/activity",
  "/v1/analytics/shielding-flow",
  "/v1/analytics/migrations",
  "/v1/analytics/miners",
  "/v1/supply",
  "/v1/prices/daily",
  "/v1/blocks",
  "/v1/blocks/{heightOrHash}/transactions",
  "/v1/transactions",
  "/v1/addresses/{address}/transactions",
  "/v1/rich-list",
  "/v1/reorgs",
];

export const FORMAT_PARAM: ApiParam = {
  name: "format",
  kind: "query",
  type: "csv | json",
  required: false,
  description:
    "The same answer as a file: csv, or json (the same table with its provenance). See the Exports convention.",
};

/** The catalogue with `format` on every exportable endpoint, added once rather than per entry. */
export function withFormatParam(groups: ApiGroup[]): ApiGroup[] {
  return groups.map((g) => ({
    ...g,
    endpoints: g.endpoints.map((e) =>
      EXPORTABLE_PATHS.includes(e.path) ? { ...e, params: [...e.params, FORMAT_PARAM] } : e,
    ),
  }));
}
