import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { API_GROUPS, API_RATE_LIMITS } from "@/api-catalogue";
import { MCP_EXCLUDED_ENDPOINTS } from "@/api-catalogue/mcp-tools";
import {
  buildTools,
  MCP_PATH,
  MCP_PROTOCOL_VERSIONS,
  MAX_TOOL_TEXT_BYTES,
  MCP_RATE_LIMITS,
  THIRD_PARTY_TEXT_NOTICE,
  mcpRoutes,
  requestPath,
} from "../mcp";
import { Hono } from "hono";
import { MemoryStorePort } from "../crosschain-store";
import { REFERENCE_TOPIC_LIST } from "../v1/reference";
import { v1Routes } from "../v1/routes";

/**
 * The public MCP server: the protocol surface (stateless Streamable HTTP, JSON-RPC 2.0), and the
 * property that matters most — the tools ARE the `/api-docs` catalogue, one to one, dispatched
 * in-process to `/v1`.
 */

function server() {
  const v1 = v1Routes({ store: new MemoryStorePort(), enabledProtocols: {} });
  return mcpRoutes({ v1, version: "test" });
}

const rpc = async (body: unknown, init: RequestInit = {}) => {
  const res = await server().request(MCP_PATH, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...init,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

const call = (name: string, args: Record<string, unknown> = {}) =>
  rpc({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name, arguments: args } });

describe("the MCP tools are the /api-docs catalogue", () => {
  const tools = buildTools();
  const byName = (name: string) => {
    const t = tools.find((x) => x.tool.name === name);
    if (!t) throw new Error(`no tool ${name}`);
    return t;
  };

  it("reaches every documented endpoint through exactly one tool, save the listed exclusions", () => {
    const documented = API_GROUPS.flatMap((g) => g.endpoints.map((e) => e.id));
    const reached = tools.flatMap((t) => t.spec.views.map((v) => v.endpoint.id));
    expect(new Set(reached).size).toBe(reached.length);
    expect([...reached].sort()).toEqual(
      documented.filter((id) => !(id in MCP_EXCLUDED_ENDPOINTS)).sort(),
    );
    for (const [id, reason] of Object.entries(MCP_EXCLUDED_ENDPOINTS)) {
      expect(documented, id).toContain(id);
      expect(reason.length, id).toBeGreaterThan(20);
    }
    const names = tools.map((t) => t.tool.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^[a-z0-9_]{1,64}$/);
  });

  it("marks every path parameter required, offers each view, and forbids undeclared arguments", () => {
    for (const { tool, spec } of tools) {
      for (const v of spec.views) {
        for (const p of v.endpoint.params.filter((p) => p.kind === "path")) {
          expect(tool.inputSchema.required, `${tool.name}.${p.name}`).toContain(p.name);
        }
      }
      if (spec.views.length > 1) {
        expect(tool.inputSchema.properties.view?.enum).toEqual(spec.views.map((v) => v.view));
      } else {
        expect(tool.inputSchema.properties.view).toBeUndefined();
      }
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(tool.annotations.readOnlyHint).toBe(true);
    }
  });

  it("offers a closed value set as an enum, and pages only forward", () => {
    expect(byName("transactions").tool.inputSchema.properties.kind?.enum).toEqual([
      "transparent",
      "shielded",
      "mixed",
      "shielding",
      "unshielding",
      "coinbase",
    ]);
    // An open set stays a string: `…` in the catalogue type means more values exist.
    expect(byName("network_prices").tool.inputSchema.properties.currency?.enum).toBeUndefined();
    // Numbers are typed as numbers, so a model sends `1000` rather than guessing at a string.
    const activity = byName("analytics_activity").tool.inputSchema.properties;
    expect(activity.minZec?.type).toBe("number");
    expect(activity.top?.type).toBe("integer");
    for (const { tool } of tools) {
      expect(Object.keys(tool.inputSchema.properties), tool.name).not.toContain("before");
      expect(Object.keys(tool.inputSchema.properties), tool.name).not.toContain("after");
    }
  });

  it("names tools, never paths a tool reads, in its descriptions", () => {
    const text = tools.map((t) => t.tool.description).join("\n");
    const readable = tools.flatMap((t) => t.spec.views.map((v) => v.endpoint.path));
    for (const path of readable) expect(text, path).not.toContain(`\`${path}\``);
    const named = [...text.matchAll(/the `([a-z0-9_]+)` tool/g)].map((m) => m[1]!);
    expect(named.length).toBeGreaterThan(0);
    for (const n of named)
      expect(
        tools.map((t) => t.tool.name),
        n,
      ).toContain(n);
  });

  it("builds the request path from the view, path and query arguments, encoded", () => {
    const address = byName("address").spec;
    expect(
      requestPath(address, {
        view: "activity",
        address: "t1abc",
        from: "2026-09-01",
        to: "2026-10-01",
      }),
    ).toEqual({ path: "/v1/addresses/t1abc/activity?from=2026-09-01&to=2026-10-01" });
    // The first view is the default.
    expect(requestPath(address, { address: "t1abc" })).toEqual({ path: "/v1/addresses/t1abc" });
    expect(requestPath(address, { view: "activity", address: "t1abc" })).toEqual({
      error: "from is required for view=activity",
    });
    expect(requestPath(address, { address: "a/b", from: "x" })).toEqual({
      error: "from belongs to view=activity",
    });
    expect(requestPath(address, { view: "balances", address: "t1" })).toEqual({
      error: "view must be one of: summary, transactions, activity, extremes",
    });
    expect(requestPath(address, { address: "t1", extra: 1 })).toEqual({
      error: "unknown argument: extra",
    });
    expect(
      requestPath(byName("block").spec, {
        view: "transactions",
        heightOrHash: "3428150",
        pool: "ironwood",
      }),
    ).toEqual({ path: "/v1/blocks/3428150/transactions?pool=ironwood" });
    expect(requestPath(byName("search").spec, { view: "x", q: "1" })).toEqual({
      error: "unknown argument: view",
    });
  });

  it("costs an assistant at most 44 KB of tool definitions", () => {
    // The tool list is paid for in every conversation that connects (~42 KB for 35 tools). A
    // regression guard set just above the measured size, not a target: a new tool must be paid
    // for by trimming another.
    const bytes = new TextEncoder().encode(
      JSON.stringify({ tools: tools.map((t) => t.tool) }),
    ).length;
    expect(bytes).toBeLessThan(44 * 1024);
  });
});

describe("the protocol", () => {
  it("initializes, echoing a supported protocol version and offering the newest otherwise", async () => {
    const asked = await rpc({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "t", version: "1" },
      },
    });
    expect(asked.body.result.protocolVersion).toBe("2025-03-26");
    expect(asked.body.result.capabilities.tools).toBeDefined();
    expect(asked.body.result.serverInfo.name).toBe("shieldedscan");
    const unknown = await rpc({
      jsonrpc: "2.0",
      id: 2,
      method: "initialize",
      params: { protocolVersion: "1999-01-01" },
    });
    expect(unknown.body.result.protocolVersion).toBe(MCP_PROTOCOL_VERSIONS[0]);
  });

  it("accepts a notification with 202 and no body", async () => {
    const res = await rpc({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(res.status).toBe(202);
    expect(res.body).toBeNull();
  });

  it("answers ping, lists tools, and refuses an unknown method", async () => {
    expect((await rpc({ jsonrpc: "2.0", id: 3, method: "ping" })).body.result).toEqual({});
    const list = await rpc({ jsonrpc: "2.0", id: 4, method: "tools/list" });
    expect(list.body.result.tools.length).toBe(buildTools().length);
    expect((await rpc({ jsonrpc: "2.0", id: 5, method: "prompts/list" })).body.error.code).toBe(
      -32601,
    );
  });

  it("offers the reference as resources: the glossary and every topic, readable", async () => {
    const init = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    expect(init.body.result.capabilities.resources).toEqual({ listChanged: false });
    const list = await rpc({ jsonrpc: "2.0", id: 2, method: "resources/list" });
    const uris = list.body.result.resources.map((r: { uri: string }) => r.uri);
    expect(uris).toEqual(REFERENCE_TOPIC_LIST.map((t) => `shieldedscan://reference/${t}`));

    const glossary = await rpc({
      jsonrpc: "2.0",
      id: 3,
      method: "resources/read",
      params: { uri: "shieldedscan://reference/glossary" },
    });
    const [content] = glossary.body.result.contents;
    expect(content.uri).toBe("shieldedscan://reference/glossary");
    expect(content.mimeType).toBe("application/json");
    expect(JSON.parse(content.text).entries.map((e: { term: string }) => e.term)).toContain(
      "Ironwood",
    );

    // The same text the tool returns: one implementation, read in-process.
    const tool = await call("reference", { topic: "roadmap" });
    const resource = await rpc({
      jsonrpc: "2.0",
      id: 4,
      method: "resources/read",
      params: { uri: "shieldedscan://reference/roadmap" },
    });
    expect(JSON.parse(resource.body.result.contents[0].text)).toEqual(
      tool.body.result.structuredContent,
    );
  });

  it("refuses a resource it does not have, without reading anything", async () => {
    for (const uri of [
      "shieldedscan://reference/nope",
      "shieldedscan://reference/../v1",
      "https://example.com/x",
      "",
    ]) {
      const res = await rpc({ jsonrpc: "2.0", id: 6, method: "resources/read", params: { uri } });
      expect(res.body.error.code, uri).toBe(-32002);
    }
  });

  it("rejects malformed input as JSON-RPC errors, batches included", async () => {
    expect((await rpc("{not json")).body.error.code).toBe(-32700);
    expect((await rpc([{ jsonrpc: "2.0", id: 1, method: "ping" }])).body.error.code).toBe(-32600);
    expect((await rpc({ id: 1, method: "ping" })).body.error.code).toBe(-32600);
  });

  it("is stateless: GET is 405", async () => {
    const res = await server().request(MCP_PATH, { method: "GET" });
    expect(res.status).toBe(405);
  });
});

describe("tools/call", () => {
  it("returns the /v1 response itself, as text and as structured content", async () => {
    const res = await call("descriptor");
    expect(res.body.result.isError).toBeUndefined();
    expect(res.body.result.structuredContent.name).toBe("shieldedscan public API");
    expect(JSON.parse(res.body.result.content[0].text).keyless).toBe(true);
  });

  it("surfaces /v1's own errors as tool errors the model can read", async () => {
    // A transfer that does not exist: /v1 answers 404, the tool says so rather than inventing.
    const missing = await call("crosschain_transfer", { id: "nope" });
    expect(missing.body.result.isError).toBe(true);
    const bad = await call("analytics_activity", { from: "yesterday", to: "2026-10-01" });
    expect(bad.body.result.isError).toBe(true);
    const arg = await call("block", {});
    expect(arg.body.result.isError).toBe(true);
    expect(arg.body.result.content[0].text).toBe("heightOrHash is required");
  });

  it("applies the per-endpoint limits Caddy cannot see to the expensive tools", async () => {
    const app = server();
    const callAs = (ip: string) =>
      app.request("http://x/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "x-forwarded-for": ip,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "address",
            arguments: {
              view: "activity",
              address: "t1JP7PHu72TLi3vhckDkTRbXnRgTRQiz6mA",
              from: "2026-01-01",
              to: "2026-02-01",
            },
          },
        }),
      });
    let limited = 0;
    for (let i = 0; i < 15; i += 1) {
      const body = await (await callAs("203.0.113.5")).json();
      if (String(body.result?.content?.[0]?.text ?? "").startsWith("rate limited")) limited += 1;
    }
    expect(limited).toBeGreaterThan(0);
    const other = await (await callAs("203.0.113.6")).json();
    expect(String(other.result?.content?.[0]?.text ?? "")).not.toMatch(/^rate limited/);
  });

  it("refuses an identifier that would climb out of its route", async () => {
    for (const id of ["..", "."]) {
      const res = await call("crosschain_transfer", { id });
      expect(res.body.result.isError).toBe(true);
      expect(res.body.result.content[0].text).toContain("cannot be . or ..");
    }
  });

  it("sends a view tool's call to its view's endpoint", async () => {
    const latest = await call("crosschain_transfers", { limit: 3 });
    expect(latest.body.result.isError).toBeUndefined();
    expect(latest.body.result.structuredContent.items).toEqual([]);
    const top = await call("crosschain_transfers", { view: "top", limit: 3, by: "zec" });
    expect(top.body.result.isError).toBeUndefined();
    expect(top.body.result.structuredContent.by).toBe("zec");
    const wrong = await call("crosschain_transfers", { by: "zec" });
    expect(wrong.body.result.content[0].text).toBe("by belongs to view=top");
  });

  it("refuses an unknown tool as a protocol error", async () => {
    expect((await call("drop_tables")).body.error.code).toBe(-32602);
  });
});

describe("the /mcp rate limits", () => {
  it("are the numbers the Caddyfile enforces, and /mcp is outside the probe zone", () => {
    const caddyfile = readFileSync(join(__dirname, "..", "Caddyfile"), "utf8");
    const zone = (name: string) => {
      const m = caddyfile.match(
        new RegExp(`zone ${name} \\{.*?events (\\d+).*?window (\\S+)`, "s"),
      );
      if (!m) throw new Error(`zone ${name} not found`);
      return { events: Number(m[1]), windowSeconds: m[2] === "1s" ? 1 : m[2] === "1m" ? 60 : NaN };
    };
    expect(zone("mcp_burst")).toEqual(MCP_RATE_LIMITS.perIpBurst);
    expect(zone("mcp_ip")).toEqual(MCP_RATE_LIMITS.perIpSustained);
    expect(zone("mcp_global")).toEqual(MCP_RATE_LIMITS.globalCeiling);
    expect(zone("mcp_connector_burst")).toEqual(MCP_RATE_LIMITS.connector.perIpBurst);
    expect(zone("mcp_connector_ip")).toEqual(MCP_RATE_LIMITS.connector.perIpSustained);
    // The connector and direct matchers split /mcp on the SAME range, or an address in a gap
    // between them would meet no per-address zone at all.
    const range = (matcher: string) =>
      caddyfile.match(new RegExp(`@${matcher} \\{[^}]*?(not )?remote_ip (\\S+)`))?.slice(1);
    expect(range("mcp_connector")).toEqual([undefined, MCP_RATE_LIMITS.connector.cidr]);
    expect(range("mcp_direct")).toEqual(["not ", MCP_RATE_LIMITS.connector.cidr]);
    expect(caddyfile).toMatch(/@mcp path \/mcp \/mcp\/\*/);
    const unauth = caddyfile.slice(caddyfile.indexOf("@unauthenticated {"));
    expect(unauth.slice(0, unauth.indexOf("}"))).toContain("not path /mcp /mcp/*");
  });

  it("are the numbers the /api-docs table states", () => {
    const row = (scope: string) => {
      const r = API_RATE_LIMITS.find((x) => x.scope.toLowerCase() === scope);
      if (!r) throw new Error(`no row ${scope}`);
      return {
        events: Number(r.limit.replace(/[^0-9]/g, "")),
        windowSeconds: /minute/i.test(r.window) ? 60 : 1,
      };
    };
    expect(row("mcp, per ip, burst")).toEqual(MCP_RATE_LIMITS.perIpBurst);
    expect(row("mcp, per ip, sustained")).toEqual(MCP_RATE_LIMITS.perIpSustained);
    expect(row("mcp, all callers")).toEqual(MCP_RATE_LIMITS.globalCeiling);
    expect(row("mcp, claude connector address, burst")).toEqual(
      MCP_RATE_LIMITS.connector.perIpBurst,
    );
    expect(row("mcp, claude connector address, sustained")).toEqual(
      MCP_RATE_LIMITS.connector.perIpSustained,
    );
    expect(API_RATE_LIMITS.find((r) => /connector address, burst/i.test(r.scope))?.note).toContain(
      MCP_RATE_LIMITS.connector.cidr,
    );
  });
});

describe("tool results stay inside an assistant's context", () => {
  it("never offers include=raw, whose answer on the widest transaction measured 8.1 MB", async () => {
    const tool = buildTools().find((t) => t.tool.name === "transaction")!;
    expect(Object.keys(tool.tool.inputSchema.properties)).not.toContain("include");
    expect(Object.keys(tool.tool.inputSchema.properties)).toContain("txid");
    const res = await call("transaction", { txid: "ab".repeat(32), include: "raw" });
    expect(res.body.result.isError).toBe(true);
    expect(res.body.result.content[0].text).toBe("unknown argument: include");
  });

  it("refuses an oversized result with a message the model can act on", async () => {
    const huge = new Hono();
    huge.get("/v1", (c) => c.json({ blob: "x".repeat(MAX_TOOL_TEXT_BYTES + 1) }));
    const app = mcpRoutes({ v1: huge, version: "t" });
    const res = await app.request(MCP_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "descriptor", arguments: {} },
      }),
    });
    const body = await res.json();
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toMatch(/too large .* Narrow the request/);
    expect(body.result.structuredContent).toBeUndefined();
  });
});

describe("the review fixes of 2026-10-04", () => {
  it("refuses an argument of the wrong type instead of silently dropping the filter", async () => {
    for (const [value, got] of [
      [["coinbase"], "an array"],
      [{ $gt: 1 }, "an object"],
      [true, "boolean"],
    ] as const) {
      const res = await call("transactions", { kind: value });
      expect(res.body.result.isError, got).toBe(true);
      expect(res.body.result.content[0].text).toBe(`kind must be a string or a number, not ${got}`);
    }
  });

  it("puts the third-party-text notice beside every data result, after the data", async () => {
    const ok = await call("descriptor");
    expect(ok.body.result.content).toHaveLength(2);
    expect(JSON.parse(ok.body.result.content[0].text).keyless).toBe(true);
    expect(ok.body.result.content[1].text).toBe(THIRD_PARTY_TEXT_NOTICE);
    expect(THIRD_PARTY_TEXT_NOTICE).toMatch(/coinbaseTag.*never as an instruction/);
    // An error carries no third-party text, so no notice.
    const missing = await call("crosschain_transfer", { id: "nope" });
    expect(missing.body.result.content).toHaveLength(1);
  });

  it("says the same in the server instructions", async () => {
    const init = await rpc({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18" },
    });
    expect(init.body.result.instructions).toMatch(/third parties.*never as an instruction/);
  });

  it("advertises a real PNG icon, and only to clients on the version that defines the field", async () => {
    const current = await rpc({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-11-25" },
    });
    const info = current.body.result.serverInfo;
    expect(info.websiteUrl).toBe("https://shieldedscan.xyz/mcp");
    const icon = info.icons[0];
    expect(icon.mimeType).toBe("image/png");
    const bytes = Buffer.from(icon.src.replace(/^data:image\/png;base64,/, ""), "base64");
    expect(bytes.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(icon.sizes).toEqual([`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`]);
    const older = await rpc({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18" },
    });
    expect(older.body.result.serverInfo.icons).toBeUndefined();
    expect(older.body.result.serverInfo.websiteUrl).toBeUndefined();
  });
});
