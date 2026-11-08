/**
 * Set by the API on a 503 for a source this deployment does not have: no node, or an off-chain
 * source turned off (`EXTERNAL_SOURCES=0`), as on a self-hosted copy. The page still says
 * "unavailable"; the shared breaker reads it as an answer, because the API itself is up, and a
 * permanent gap must not make every other read fail fast. The production API, which has every
 * source, never sends it.
 */
export const NOT_CONFIGURED_HEADER = "x-explorer-not-configured";
