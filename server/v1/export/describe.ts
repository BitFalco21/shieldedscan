import { ADDRESS_EXPORT_CAP, V1_ADDRESS_EXPORT_PATH } from "./address-route";
import { OPEN_DATASET_URL } from "./open-dataset";
import { CROSSCHAIN_EXPORT_ENABLED, CROSSCHAIN_EXPORT_REFUSAL, EXPORT_PARAM } from "./policy";
import { EXPORTS } from "./registry";
import { EXPORT_FORMATS } from "./render";

/** A Hono route pattern as the descriptor writes paths: `:addr` → `{address}`. */
export function templateOf(pattern: string): string {
  return pattern.replace(":addr", "{address}").replace(":id", "{heightOrHash}");
}

/** The exportable endpoints in a list of mounted `GET <template>` lines. */
export function exportableEndpoints(mounted: readonly string[]): string[] {
  return Object.keys(EXPORTS)
    .map(templateOf)
    .filter((t) => mounted.includes(`GET ${t}`));
}

/** The descriptor's `exports` block: what answers `format`, how, and what never does. */
export function exportsDescriptor(mounted: readonly string[]) {
  return {
    parameter: EXPORT_PARAM,
    formats: EXPORT_FORMATS,
    endpoints: exportableEndpoints(mounted),
    conventions: {
      csv: "RFC 4180, a header row, units in column names (_zat integer zatoshi, _utc ISO 8601, period_start a UTC day)",
      nulls:
        "an empty CSV cell is NULL, never zero; the JSON form names each one's reason in `unknowns`",
      provenance:
        "X-Source (the exact call), X-Data-Height and X-Data-Through where the answer states them, X-As-Of",
      lists: "one page per request, the next in the Link header",
      errors: "always the JSON envelope, whatever format asked",
    },
    ...(mounted.includes(`GET ${V1_ADDRESS_EXPORT_PATH}`)
      ? {
          addressExport: {
            path: V1_ADDRESS_EXPORT_PATH,
            maxTransactions: ADDRESS_EXPORT_CAP,
            beyondCap: OPEN_DATASET_URL,
          },
        }
      : {}),
    refused: CROSSCHAIN_EXPORT_ENABLED
      ? []
      : [{ path: "/v1/crosschain/*", reason: CROSSCHAIN_EXPORT_REFUSAL }],
  };
}
