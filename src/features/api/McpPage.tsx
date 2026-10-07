import Link from "@/components/Link";
import { CopyButton } from "@/components/CopyButton";
import { API_RATE_LIMITS } from "@/api-catalogue";
import { mcpClients } from "./mcp-clients";
import { McpConnect } from "./McpConnect";
import { MCP_DEMO } from "./mcp-demo";
import { McpDemo } from "./McpDemo";
import { MCP_URL, mcpToolGroups } from "@/api-catalogue/mcp-tools";
import { McpToolList } from "./McpToolList";

/**
 * `/mcp`: how to connect an AI assistant to this explorer's MCP server.
 *
 * The hero is a demonstration: a real question, the tool call an assistant makes, and what the
 * server answered (`mcp-demo.ts`). Everything below is derived: the URL from `MCP_URL`, the tool
 * list from `mcpToolSpecs`, the limits from the `/api-docs` rate table that a test holds against
 * the Caddyfile.
 */
export function McpPage() {
  const groups = mcpToolGroups();
  const toolCount = groups.reduce((n, g) => n + g.tools.length, 0);
  const limits = API_RATE_LIMITS.filter((r) => r.scope.toLowerCase().startsWith("mcp"));
  const clients = mcpClients(MCP_URL);

  return (
    <div className="pb-12">
      <div className="grid gap-10 pt-10 pb-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-center lg:gap-12">
        <header className="min-w-0">
          <div className="microlabel">MCP SERVER</div>
          <h1 className="mt-3 text-4xl leading-[1.05] font-extrabold tracking-tight text-ink-bright sm:text-5xl xl:text-6xl">
            Ask your AI
            <br />
            about Zcash.
          </h1>
          <p className="mt-5 max-w-md text-sm leading-relaxed text-ink-dim">
            Add one URL to your assistant and it reads the chain through {toolCount} tools. No key,
            and nothing is stored.
          </p>
          <div className="panel mt-6 flex items-center gap-3 px-4 py-3">
            <span aria-hidden className="text-green-dim select-none">
              $
            </span>
            <code className="min-w-0 flex-1 overflow-x-auto text-sm whitespace-nowrap text-green">
              {MCP_URL}
            </code>
            <CopyButton value={MCP_URL} label="MCP server URL" withLabel />
          </div>
          <nav aria-label="Setup by assistant" className="mt-4 flex flex-wrap items-center gap-1">
            <span className="mr-1 text-xs text-ink-faint">Setup for</span>
            {clients.map((c) => (
              <a
                key={c.id}
                href={`#connect-${c.id}`}
                className="rounded-sm border border-edge-faint px-1.5 py-0.5 text-xs text-ink-dim hover:border-edge hover:text-green"
              >
                {c.name}
              </a>
            ))}
          </nav>
        </header>

        <section aria-labelledby="mcp-demo-heading" className="min-w-0">
          <h2 id="mcp-demo-heading" className="sr-only">
            What it looks like
          </h2>
          <McpDemo exchanges={MCP_DEMO} />
          <p className="mt-2 text-xs text-ink-faint">
            Real responses from the live server. The wording of each answer is an example.
          </p>
        </section>
      </div>

      <section aria-labelledby="mcp-connect-heading" className="mt-16 max-w-3xl">
        <h2 id="mcp-connect-heading" className="text-xl font-bold text-ink-bright">
          Connect your assistant
        </h2>
        <div className="mt-4">
          <McpConnect clients={clients} />
        </div>
      </section>

      <section aria-labelledby="mcp-tools-heading" className="mt-14">
        <h2 id="mcp-tools-heading" className="text-xl font-bold text-ink-bright">
          {toolCount} tools
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-ink-dim">
          Each returns exactly what the matching{" "}
          <Link href="/api-docs" className="text-green hover:underline">
            API endpoint
          </Link>{" "}
          returns.
        </p>
        <div className="mt-5">
          <McpToolList groups={groups} />
        </div>
      </section>

      <section aria-labelledby="mcp-facts-heading" className="mt-14">
        <h2 id="mcp-facts-heading" className="sr-only">
          Good to know
        </h2>
        <dl className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-sm text-ink">Encrypted stays encrypted</dt>
            <dd className="mt-1 text-xs leading-relaxed text-ink-dim">
              A shielded amount is never a number: it comes back marked shielded, so your assistant
              can say why it is hidden.
            </dd>
          </div>
          <div>
            <dt className="text-sm text-ink">Current on Zcash</dt>
            <dd className="mt-1 text-xs leading-relaxed text-ink-dim">
              Ironwood launched after most AI models were trained, so the server gives your
              assistant a glossary and a dated Zcash reference to read first.
            </dd>
          </div>
          <div>
            <dt className="text-sm text-ink">Read-only and keyless</dt>
            <dd className="mt-1 text-xs leading-relaxed text-ink-dim">
              Nothing to sign up for, nothing written, no request logged.
            </dd>
          </div>
          <div>
            <dt className="text-sm text-ink">Fair-use limits</dt>
            <dd className="mt-1 text-xs leading-relaxed text-ink-dim">
              {limits.map((l, i) => (
                <span key={l.scope}>
                  {i > 0 ? ", " : ""}
                  {l.limit} per {l.window.replace(/^1 /, "")} ({l.scope.replace(/^MCP,\s*/i, "")})
                </span>
              ))}
              .
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
