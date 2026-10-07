import Link from "@/components/Link";
import { Badge } from "@/components/Badge";
import { CopyButton } from "@/components/CopyButton";
import { Panel } from "@/components/Panel";
import {
  API_BASE_URL,
  API_CODE_EXAMPLES,
  API_RATE_LIMITS,
  API_CONVENTIONS,
  API_ERRORS,
  API_GROUPS,
  curlCommand,
  type ApiEndpoint,
} from "@/api-catalogue";
import { ScrollSpy } from "@/components/ScrollSpy";
import { TryIt } from "./TryIt";
import { PageHeader } from "@/components/PageHeader";

/**
 * The API reference — Mintlify's layout grammar, spoken in Phosphor.
 *
 * A sticky section sidebar, one anchored section per endpoint, the two-column split with prose
 * left and code right, method pills, and copy affordances on everything a developer will paste.
 * The sidebar is plain anchor links that `ScrollSpy` highlights, mobile gets a native `<details>`
 * table of contents, and the only client components are `ScrollSpy`, `TryIt` and `CopyButton`:
 * without JavaScript the page is a complete, navigable reference.
 *
 * Everything renders from the typed catalogue in `@/api-catalogue`; the page contains no
 * endpoint knowledge of its own, so the reference cannot disagree with itself.
 */

/**
 * Inline `code` and **bold** in catalogue prose, without a markdown dependency. The same
 * strings reach MCP tool descriptions, where an assistant reads the markdown as intended.
 */
function Prose({ text }: { text: string }) {
  const parts = text.split("`");
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <code
            key={i}
            className="rounded-sm bg-green-wash-strong px-1 py-0.5 text-[0.92em] text-green"
          >
            {part}
          </code>
        ) : (
          <Emphasis key={i} text={part} />
        ),
      )}
    </>
  );
}

/** `**bold**` spans within one non-code run. An unpaired `**` stays literal. */
function Emphasis({ text }: { text: string }) {
  const runs = text.split(/\*\*(.+?)\*\*/);
  return (
    <>
      {runs.map((run, i) =>
        i % 2 === 1 ? (
          <strong key={i} className="font-bold text-ink">
            {run}
          </strong>
        ) : (
          <span key={i}>{run}</span>
        ),
      )}
    </>
  );
}

/**
 * The one-line curl. The command is built by `curlCommand` in the catalogue, so the test that
 * shell-parses it checks the string a reader actually copies.
 */
function CurlLine({ endpoint }: { endpoint: ApiEndpoint }) {
  const command = curlCommand(endpoint);
  return (
    <div className="panel flex items-center justify-between gap-2 px-3 py-2">
      <pre className="min-w-0 overflow-x-auto text-xs leading-relaxed text-ink">
        <span aria-hidden className="text-green-dim select-none">
          ${" "}
        </span>
        {command}
      </pre>
      <CopyButton value={command} label={`curl for ${endpoint.path}`} />
    </div>
  );
}

/** A labelled, copyable block of code: an example response or a client snippet. */
function CodeBlock({
  label,
  code,
  copyLabel,
  className = "",
}: {
  label: string;
  code: string;
  copyLabel: string;
  /** Layout classes for the panel. */
  className?: string;
}) {
  return (
    <div className={["panel", className, "px-0 py-0"].filter(Boolean).join(" ")}>
      <div className="hairline-b flex items-center justify-between px-3 py-2">
        <span className="microlabel">{label}</span>
        <CopyButton value={code} label={copyLabel} />
      </div>
      <pre className="overflow-x-auto px-3 py-3 text-[12px] leading-relaxed text-ink-dim">
        {code}
      </pre>
    </div>
  );
}

/** A header cell, in the one style every table on this page shares. */
function Th({ children }: { children: string }) {
  return <th className="border-b border-edge-faint pb-2 font-normal">{children}</th>;
}

function ParamsTable({ endpoint }: { endpoint: ApiEndpoint }) {
  if (endpoint.params.length === 0) {
    return <p className="text-xs text-ink-faint">No parameters — and unknown ones are a 400.</p>;
  }
  // A panel, like every table on the site: `.data-table` sets the header rule, the gutters and
  // the row height, and it is only drawn inside one (e2e/layout.spec.ts).
  return (
    <Panel density="compact">
      <div className="overflow-x-auto">
        <table className="data-table w-full text-left text-sm">
          <caption className="sr-only">Parameters for {endpoint.path}</caption>
          <thead>
            <tr className="microlabel">
              <Th>PARAM</Th>
              <Th>TYPE</Th>
              <Th>DESCRIPTION</Th>
            </tr>
          </thead>
          <tbody>
            {endpoint.params.map((param) => (
              <tr key={param.name} className="hairline-b align-top last:border-0">
                {/* The name and REQUIRED may sit on two lines, each whole, so the column stays
                    narrow. */}
                <td>
                  <code className="whitespace-nowrap text-green">{param.name}</code>
                  {param.required ? (
                    <>
                      {" "}
                      <span className="text-[10px] tracking-wider whitespace-nowrap text-warn">
                        REQUIRED
                      </span>
                    </>
                  ) : null}
                  <div className="mt-0.5 text-[10px] tracking-wider text-ink-faint uppercase">
                    {param.kind}
                  </div>
                </td>
                {/* Free to wrap, so a long enum cannot set the column's width and squeeze
                    DESCRIPTION. Lines break at the spaces around each `|`, and inside a token
                    only where text normally may (after a hyphen). */}
                <td className="text-xs text-ink-dim">{param.type}</td>
                {/* `wrap-anywhere`, which, unlike `break-words`, also lowers the cell's minimum
                    width, so a dotted path with no break opportunity cannot widen the column. */}
                <td className="text-xs leading-relaxed wrap-anywhere text-ink-dim">
                  <Prose text={param.description} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function EndpointSection({ endpoint }: { endpoint: ApiEndpoint }) {
  return (
    <section
      id={endpoint.id}
      // `:target` is the no-JS scrollspy: the section you navigated to marks itself.
      className="-ml-4 scroll-mt-24 border-l-2 border-transparent pl-4 target:border-edge-strong"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="filled">{endpoint.method}</Badge>
        <a href={`#${endpoint.id}`} className="group min-w-0">
          <code className="text-sm break-all text-ink-bright group-hover:text-green">
            {endpoint.path}
          </code>
        </a>
      </div>
      <h3 className="mt-2 text-lg font-bold text-ink-bright">{endpoint.title}</h3>

      <div className="mt-3 grid gap-5 lg:grid-cols-2">
        <div className="min-w-0 space-y-4">
          <p className="text-sm leading-relaxed text-ink-dim">
            <Prose text={endpoint.description} />
          </p>
          <ParamsTable endpoint={endpoint} />
          {endpoint.notes?.map((note) => (
            <p
              key={note}
              className="border-l-2 border-edge-faint pl-3 text-xs leading-relaxed text-ink-faint"
            >
              <Prose text={note} />
            </p>
          ))}
        </div>
        <div className="min-w-0 space-y-2">
          <CurlLine endpoint={endpoint} />
          <TryIt method={endpoint.method} path={endpoint.path} params={endpoint.params} />
          <CodeBlock
            label="EXAMPLE RESPONSE · 200"
            code={endpoint.exampleResponse}
            copyLabel={`example response for ${endpoint.path}`}
            className="min-w-0"
          />
        </div>
      </div>
    </section>
  );
}

/** The reference's own sections, listed under START HERE beside the MCP link. */
const START_SECTIONS = [
  { id: "conventions", label: "Conventions" },
  { id: "rate-limits", label: "Rate limits" },
  { id: "code-examples", label: "Code examples" },
  { id: "errors", label: "Errors" },
] as const;

function SidebarNav() {
  return (
    <nav aria-label="API reference sections" className="space-y-5 text-sm">
      <div>
        <div className="microlabel">START HERE</div>
        <ul className="mt-2 space-y-1.5">
          {/* First, and a separate page: the MCP server is how an AI assistant uses this API. */}
          <li>
            {/* A bordered entry, not the left-rule active marker: this one leaves the page. */}
            <Link
              href="/mcp"
              className="flex items-baseline justify-between gap-2 rounded-sm border border-edge px-2 py-1 text-green hover:bg-green-wash-strong"
            >
              <span>MCP server</span>
              <span className="text-[10px] tracking-wider text-green-dim uppercase">for AI</span>
            </Link>
          </li>
          {START_SECTIONS.map((section) => (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                className="block border-l-2 border-transparent pl-2 text-ink-dim hover:text-green [&[aria-current]]:border-green [&[aria-current]]:text-green"
              >
                {section.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
      {API_GROUPS.map((group) => (
        <div key={group.id}>
          <div className="microlabel">{group.label.toUpperCase()}</div>
          <ul className="mt-2 space-y-1.5">
            {group.endpoints.map((endpoint) => (
              <li key={endpoint.id}>
                <a
                  href={`#${endpoint.id}`}
                  className="group flex items-baseline gap-1.5 border-l-2 border-transparent pl-2 [&[aria-current]]:border-green"
                >
                  <span aria-hidden className="text-[10px] text-green-dim">
                    {endpoint.method}
                  </span>
                  <code className="min-w-0 truncate text-xs text-ink-dim group-hover:text-green group-[&[aria-current]]:text-green">
                    {endpoint.path.replace("/v1", "") || "/"}
                  </code>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** Every anchored section, in the order they appear — the spy needs reading order. */
const SECTION_IDS = [
  "conventions",
  "rate-limits",
  ...API_GROUPS.flatMap((group) => group.endpoints.map((endpoint) => endpoint.id)),
  "code-examples",
  "errors",
];

export function ApiDocsPage() {
  return (
    <>
      <ScrollSpy ids={SECTION_IDS} />
      <PageHeader
        eyebrow="DEVELOPERS"
        title="API reference"
        lede={
          <>
            The chain, the shielded pools, cross-chain flows and the observed-reorg log — over plain
            keyless HTTP. No registration, no key, no identity:{" "}
            <span className="text-ink">this API cannot tell you apart from anyone else</span>, and
            its rate counters live in memory, persisted nowhere.
          </>
        }
      >
        <div className="panel mt-5 flex items-center justify-between gap-2 px-3 py-2">
          <div className="min-w-0">
            <span className="microlabel">BASE URL</span>
            <pre className="mt-0.5 overflow-x-auto text-sm text-green">{API_BASE_URL}</pre>
          </div>
          <CopyButton value={API_BASE_URL} label="base URL" />
        </div>
        <p className="mt-3 text-sm text-ink-dim">
          Using an AI assistant?{" "}
          <Link href="/mcp" className="text-green hover:underline">
            Connect it to the MCP server
          </Link>
          .
        </p>
      </PageHeader>

      {/* Mobile: a native disclosure; no JS, no state, and it never overlays content. */}
      <details className="panel mb-6 p-5 lg:hidden">
        <summary className="microlabel cursor-pointer select-none">ON THIS PAGE</summary>
        <div className="mt-3">
          <SidebarNav />
        </div>
      </details>

      <div className="flex gap-10">
        <aside className="hidden w-52 shrink-0 lg:block">
          <div className="sticky top-6 max-h-[calc(100vh-3rem)] overflow-y-auto pr-2">
            <SidebarNav />
          </div>
        </aside>

        <div className="min-w-0 flex-1 space-y-12 pb-10">
          <section id="conventions" className="scroll-mt-24">
            <h2 className="text-xl font-bold text-ink-bright">Conventions</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-dim">
              {/* No count in the prose: the list below is rendered from data. */}
              These rules hold everywhere. They exist because a privacy explorer&apos;s worst
              failure is a confident wrong number, and the contract is designed so producing one
              requires ignoring a stated reason.
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {API_CONVENTIONS.map((convention) => (
                <Panel key={convention.id} density="compact">
                  <h3 className="text-sm font-bold text-ink">{convention.title}</h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-ink-dim">
                    <Prose text={convention.body} />
                  </p>
                </Panel>
              ))}
            </div>
          </section>

          <section id="rate-limits" className="scroll-mt-24">
            <h2 className="text-xl font-bold text-ink-bright">Rate limits</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-dim">
              Free and keyless means the limits are the whole access policy — so they are stated
              exactly, and the <code className="text-green">GET /v1</code> descriptor carries them
              machine-readably. When you hit one, the 429 tells you how long to wait.
            </p>
            {/*
              A stacked list on a phone, a table above `sm`: WHY is a paragraph, and three narrow
              columns beside it would break "5 requests/second" between number and unit.
            */}
            <Panel className="mt-4">
              <dl className="space-y-4 sm:hidden">
                {API_RATE_LIMITS.map((row) => (
                  <div key={row.scope} className="hairline-b pb-3 last:border-0">
                    <dt className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-xs text-ink">{row.scope}</span>
                      <span className="text-xs whitespace-nowrap text-green">{row.limit}</span>
                      <span className="text-xs whitespace-nowrap text-ink-faint">{row.window}</span>
                    </dt>
                    <dd className="mt-1 text-xs leading-relaxed text-ink-dim">{row.note}</dd>
                  </div>
                ))}
              </dl>
              <div className="hidden overflow-x-auto sm:block">
                <table className="data-table w-full text-left text-sm">
                  <caption className="sr-only">Rate limits</caption>
                  <thead>
                    <tr className="microlabel">
                      <Th>SCOPE</Th>
                      <Th>LIMIT</Th>
                      <Th>WINDOW</Th>
                      <Th>WHY</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {API_RATE_LIMITS.map((row) => (
                      <tr key={row.scope} className="hairline-b align-top last:border-0">
                        {/* The scope is a phrase and may wrap; the figures beside it may not. */}
                        <td className="text-xs text-ink">{row.scope}</td>
                        <td className="text-xs whitespace-nowrap text-green">{row.limit}</td>
                        <td className="text-xs whitespace-nowrap text-ink-dim">{row.window}</td>
                        <td className="text-xs leading-relaxed text-ink-dim">{row.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </section>

          {API_GROUPS.map((group) => (
            <section key={group.id} aria-labelledby={`group-${group.id}`}>
              <h2
                id={`group-${group.id}`}
                className="microlabel hairline-b pb-2 !text-[13px] text-green-dim"
              >
                {group.label.toUpperCase()}
              </h2>
              <div className="mt-6 space-y-12">
                {group.endpoints.map((endpoint) => (
                  <EndpointSection key={endpoint.id} endpoint={endpoint} />
                ))}
              </div>
            </section>
          ))}

          <section id="code-examples" className="scroll-mt-24">
            <h2 className="text-xl font-bold text-ink-bright">Code examples</h2>
            <div className="mt-5 space-y-4">
              {API_CODE_EXAMPLES.map((example) => (
                <CodeBlock
                  key={example.language}
                  label={example.language.toUpperCase()}
                  code={example.code}
                  copyLabel={`${example.language} example`}
                />
              ))}
            </div>
          </section>

          <section id="errors" className="scroll-mt-24">
            <h2 className="text-xl font-bold text-ink-bright">Errors</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-dim">
              Every error is the same JSON envelope —{" "}
              <code className="text-green">{"{error: {code, message}, requestId, asOf}"}</code> —
              including a rate-limited 429, which most APIs leave as an empty body.
            </p>
            <Panel className="mt-4">
              <div className="overflow-x-auto">
                <table className="data-table w-full text-left text-sm">
                  <caption className="sr-only">HTTP status codes</caption>
                  <thead>
                    <tr className="microlabel">
                      <Th>STATUS</Th>
                      <Th>MEANING</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {API_ERRORS.map((row) => (
                      <tr key={row.status} className="hairline-b align-top last:border-0">
                        <td>
                          <code className={row.status === "200" ? "text-green" : "text-warn"}>
                            {row.status}
                          </code>
                        </td>
                        <td className="text-xs leading-relaxed text-ink-dim">
                          <Prose text={row.meaning} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </section>

          <Panel title="What this API refuses">
            <p className="max-w-2xl text-xs leading-relaxed text-ink-dim">
              No viewing-key endpoint — not even a stub; a viewing key reveals an entire transaction
              history. No sender/recipient narration and no privacy scores — the payment/change
              split is a deanonymisation heuristic, not a chain fact. No per-transaction linkability
              analysis: correlating shieldings with unshieldings is the technique chain-analysis
              firms sell, and a keyless version would let anyone run it on anyone. No broadcast
              endpoint and no fork-report endpoint. The machine-readable list ships in{" "}
              <code className="text-green">GET /v1</code> under{" "}
              <code className="text-green">refused</code>.
            </p>
          </Panel>
        </div>
      </div>
    </>
  );
}
