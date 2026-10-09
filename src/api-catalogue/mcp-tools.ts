import { API_BASE_URL, API_GROUPS, type ApiEndpoint } from "./index";

/**
 * The MCP server's tool vocabulary, in one place the server (`server/mcp.ts`) and the `/mcp`
 * page both read — so the page can never list a tool name the server does not answer to.
 *
 * Every tool reads public `/v1` endpoints from the `/api-docs` catalogue; nothing here describes
 * an endpoint, it only names and groups them. Most tools are one endpoint. A few read several
 * endpoints about one thing (an address's summary, transactions, activity and extremes) as
 * `view`s of one tool: every tool definition costs tokens in every connected conversation, and
 * a model chooses among fewer names more reliably.
 */

export const MCP_URL = `${API_BASE_URL}/mcp`;

/** Groups whose ids already read as a self-contained name; the rest are prefixed by group. */
const UNPREFIXED_GROUPS = new Set(["chain", "meta", "supply", "privacy"]);

/** A tool name from a catalogue entry: `network_fees`, `crosschain_aggregate`, `search`. */
export function mcpToolName(groupId: string, endpointId: string): string {
  const base =
    UNPREFIXED_GROUPS.has(groupId) || endpointId.startsWith(groupId)
      ? endpointId
      : `${groupId}_${endpointId}`;
  return base.replace(/-/g, "_");
}

/**
 * Parameters the API offers that a tool must not, by endpoint id. `include=raw` on a transaction
 * returns the raw hex, useless to a model and 8.1 MB on the widest transaction (13,538 inputs).
 * The API keeps the parameter; the tool never offers it.
 */
export const MCP_EXCLUDED_PARAMS: Readonly<Record<string, readonly string[]>> = {
  "transaction-detail": ["include"],
};

/**
 * Parameters no tool offers, on any endpoint. `cursor` pages forward and is all a model needs;
 * `before` is its older spelling and `after` pages backwards, and describing both on every list
 * would cost tokens in every conversation.
 */
export const MCP_EXCLUDED_PARAMS_EVERYWHERE: readonly string[] = ["before", "after"];

/**
 * Endpoints no tool reads, each with its reason. A documented endpoint is otherwise reachable
 * through exactly one tool — the test holds the catalogue to that.
 */
export const MCP_EXCLUDED_ENDPOINTS: Readonly<Record<string, string>> = {
  status: "the same live facts as `chain_info`, under an older name",
  circulating:
    "a bare decimal for price aggregators; `supply` carries the same figure with its context",
};

export interface McpViewTool {
  name: string;
  title: string;
  /** One sentence for what the views have in common, ahead of each view's own description. */
  summary: string;
  /** View name → endpoint id, in order; the first is the default. */
  views: Readonly<Record<string, string>>;
  /**
   * One description for a parameter its views describe differently, where those differences are
   * wording rather than meaning — four near-copies of "an address" cost four times one.
   */
  params?: Readonly<Record<string, string>>;
}

/** Tools that read several endpoints as views. */
export const MCP_VIEW_TOOLS: readonly McpViewTool[] = [
  {
    name: "block",
    title: "A block, or its transactions",
    summary: "One block by height or hash.",
    views: { detail: "block-detail", transactions: "block-transactions" },
  },
  {
    name: "transaction",
    title: "A transaction, or what it reveals",
    summary: "One transaction by txid.",
    views: { detail: "transaction-detail", privacy: "tx-privacy" },
    params: { txid: "The transaction id: 64 hex characters." },
  },
  {
    name: "address",
    title: "An address: summary, transactions, activity, extremes",
    summary: "One Zcash address.",
    views: {
      summary: "address",
      transactions: "address-transactions",
      activity: "address-activity",
      extremes: "address-extremes",
    },
    params: {
      address:
        "A Zcash address: any kind for view=summary; a transparent one (t1…, t3…) for the other views, since a shielded address has no public history. (e.g. t1a7HnBdsBSvkGZQXD5vPYqoWRvnpG555Jy)",
    },
  },
  {
    name: "rich_list",
    title: "The transparent rich list, its distribution, or named addresses",
    summary: "Transparent balances only.",
    views: { list: "rich-list", distribution: "rich-list-distribution", labels: "labels" },
  },
  {
    name: "nodes",
    title: "Network nodes: summary, list, geography, concentration",
    summary: "The Zcash nodes this explorer's crawler reached in the last day.",
    views: {
      summary: "nodes-summary",
      list: "nodes-list",
      geography: "nodes-geography",
      concentration: "nodes-concentration",
    },
  },
  {
    name: "reorgs",
    title: "Chain reorganisations: summary or list",
    summary: "Reorganisations this explorer's node itself observed.",
    views: { summary: "reorgs-summary", list: "reorgs-list" },
  },
  {
    name: "crosschain_transfers",
    title: "Cross-chain transfers: latest or largest",
    summary: "Individual swaps through public swap protocols.",
    views: { latest: "transfers", top: "transfers-top" },
  },
];

export interface McpToolView {
  /** Null for a tool that reads one endpoint. */
  view: string | null;
  groupId: string;
  endpoint: ApiEndpoint;
}

export interface McpToolSpec {
  name: string;
  title: string;
  /** The view tool's own summary; null for a one-endpoint tool. */
  summary: string | null;
  /** The view tool's shared parameter descriptions, if any. */
  params: Readonly<Record<string, string>>;
  /** One entry for a one-endpoint tool; several, default first, for a view tool. */
  views: McpToolView[];
}

/**
 * Every tool, in catalogue order: a view tool sits where its first endpoint does. Throws if the
 * view table names an endpoint the catalogue does not have — at build time, not on a call.
 */
export function mcpToolSpecs(): McpToolSpec[] {
  const located = new Map(
    API_GROUPS.flatMap((g) => g.endpoints.map((e) => [e.id, { groupId: g.id, endpoint: e }])),
  );
  const viewToolOf = new Map<string, McpViewTool>();
  for (const t of MCP_VIEW_TOOLS) {
    for (const id of Object.values(t.views)) {
      if (!located.has(id)) throw new Error(`MCP view tool ${t.name} names unknown endpoint ${id}`);
      viewToolOf.set(id, t);
    }
  }
  for (const t of MCP_VIEW_TOOLS) {
    for (const name of Object.keys(t.params ?? {})) {
      const taken = Object.values(t.views).some((id) =>
        located.get(id)!.endpoint.params.some((p) => p.name === name),
      );
      if (!taken) throw new Error(`MCP view tool ${t.name} describes unknown parameter ${name}`);
    }
  }
  const specs: McpToolSpec[] = [];
  const emitted = new Set<string>();
  for (const g of API_GROUPS) {
    for (const e of g.endpoints) {
      if (e.id in MCP_EXCLUDED_ENDPOINTS) continue;
      const vt = viewToolOf.get(e.id);
      if (vt === undefined) {
        specs.push({
          name: mcpToolName(g.id, e.id),
          title: e.title,
          summary: null,
          params: {},
          views: [{ view: null, groupId: g.id, endpoint: e }],
        });
        continue;
      }
      if (emitted.has(vt.name)) continue;
      emitted.add(vt.name);
      specs.push({
        name: vt.name,
        title: vt.title,
        summary: vt.summary,
        params: vt.params ?? {},
        views: Object.entries(vt.views).map(([view, id]) => ({ view, ...located.get(id)! })),
      });
    }
  }
  return specs;
}

export interface McpToolGroup {
  label: string;
  tools: Array<{ name: string; title: string; docsId: string }>;
}

/** The tools grouped as the reference groups their (first) endpoint, for the page to list. */
export function mcpToolGroups(): McpToolGroup[] {
  const specs = mcpToolSpecs();
  return API_GROUPS.map((g) => ({
    label: g.label,
    tools: specs
      .filter((s) => s.views[0]!.groupId === g.id)
      .map((s) => ({ name: s.name, title: s.title, docsId: s.views[0]!.endpoint.id })),
  })).filter((g) => g.tools.length > 0);
}
