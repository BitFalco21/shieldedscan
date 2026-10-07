/**
 * The API documentation's single source: one typed catalogue drives the sidebar, the
 * endpoint sections, the parameter tables and the examples. A doc that exists once cannot
 * disagree with itself — and an e2e test walks this catalogue, so a section without an
 * anchor or an example without a copy button is a red test, not a reader's discovery.
 *
 * Example responses are HAND-PINNED, not fetched: the docs page is static and must render
 * identically with the API dark, up, or unreachable. When the wire contract changes, the
 * examples change in the same commit — the same rule the fixtures follow.
 */

import { API_BASE_URL } from "./base-url";
import { CHAIN_GROUP } from "./groups/chain";
import { RICH_LIST_GROUP } from "./groups/rich-list";
import { META_GROUP } from "./groups/meta";
import { REFERENCE_GROUP } from "./groups/reference";
import { SUPPLY_GROUP } from "./groups/supply";
import { NETWORK_GROUP } from "./groups/network";
import { NODES_GROUP } from "./groups/nodes";
import { PRIVACY_GROUP } from "./groups/privacy";
import { CROSSCHAIN_GROUP } from "./groups/crosschain";
import { REORGS_GROUP } from "./groups/reorgs";
import { MEMPOOL_GROUP } from "./groups/mempool";
import { ANALYTICS_GROUP } from "./groups/analytics";
import type { ApiEndpoint, ApiGroup } from "./types";

export type * from "./types";
export { API_BASE_URL } from "./base-url";
export { API_CODE_EXAMPLES } from "./code-examples";
export { API_CONVENTIONS } from "./conventions";
export { API_ERRORS } from "./errors";
export { API_RATE_LIMITS } from "./rate-limits";

/** Every documented endpoint, by group, in the order the reference and the MCP server list them. */
export const API_GROUPS: ApiGroup[] = [
  CHAIN_GROUP,
  RICH_LIST_GROUP,
  META_GROUP,
  REFERENCE_GROUP,
  SUPPLY_GROUP,
  NETWORK_GROUP,
  NODES_GROUP,
  PRIVACY_GROUP,
  CROSSCHAIN_GROUP,
  REORGS_GROUP,
  MEMPOOL_GROUP,
  ANALYTICS_GROUP,
];

/**
 * The one-line curl a reader copies, built from the endpoint's own pinned examples.
 *
 * Lives here rather than in the component so a test can shell-parse the real string. A
 * placeholder such as `<name>` would be a bash redirection, a syntax error.
 *
 * A parameter with no pinned example gets a SHELL-QUOTED placeholder: inert in a shell rather
 * than a parse error, so the worst case is a 404 the reader can see instead of a command they
 * cannot run.
 */
export function curlCommand(endpoint: ApiEndpoint): string {
  const path = endpoint.path.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const example = endpoint.params.find((p) => p.kind === "path" && p.name === name)?.example;
    return example ?? `'<${name}>'`;
  });
  // A REQUIRED query parameter rides along with its pinned example, or the copied command is a
  // 400 ("from is required") — the windowed analytics need both edges of their window. The URL
  // is then single-quoted, because an unquoted `&` backgrounds the command and drops the rest.
  const query = endpoint.params
    .filter((p) => p.kind === "query" && p.required && p.example !== undefined)
    .map((p) => `${p.name}=${encodeURIComponent(p.example!)}`)
    .join("&");
  return query === "" ? `curl ${API_BASE_URL}${path}` : `curl '${API_BASE_URL}${path}?${query}'`;
}

/**
 * The `/api-docs` anchor for one PUBLIC endpoint path, or null for anything not in the catalogue.
 *
 * Null is the important half: `/chain/*` paths are token-gated, so a citation pointing at one
 * would send a developer to an endpoint they cannot call and advertise a private surface. Only
 * paths this site documents can be linked; a private path is unrepresentable here.
 *
 * Matched against the catalogue's own templates, so `/v1/blocks/{height}` and
 * `/v1/blocks/{heightOrHash}` both resolve — a citation names the shape, not the parameter's name.
 */
export function apiDocsHrefFor(path: string): string | null {
  const normalise = (p: string) => p.replace(/\{[^}]*\}/g, "{}").replace(/\?.*$/, "");
  const wanted = normalise(path.replace(/^GET\s+/, "").trim());
  for (const group of API_GROUPS) {
    for (const endpoint of group.endpoints) {
      if (normalise(endpoint.path) === wanted) return `/api-docs#${endpoint.id}`;
    }
  }
  return null;
}
