"use client";

import { useState } from "react";
import { CopyButton } from "@/components/CopyButton";
import { apiBaseUrl } from "@/lib/site";
import type { ApiParam } from "@/api-catalogue";

export interface TryItProps {
  method: "GET";
  path: string;
  params: ApiParam[];
}

interface TryItResult {
  status: number;
  statusText: string;
  ms: number;
  body: string;
  contentType: string;
}

const TIMEOUT_MS = 12_000;

/** Longer bodies are cut: the box is for reading a response, not for downloading one. */
const MAX_BODY_CHARS = 20_000;

/**
 * The playground: fill the parameters, send the request, read the real response.
 *
 * The request goes from the VISITOR'S browser straight to the API — this site never sees
 * it, proxies nothing, and stores nothing; the component holds its state in memory and
 * writes to no storage, the same standard the ⌘K palette meets. That direct path is also
 * why `connect-src` carries the API origin: our own CSP would otherwise block the fetch.
 *
 * The URL preview updates as you type and is exactly the string sent — no hidden
 * parameters, no defaults smuggled in. Empty optional params are omitted entirely, so
 * what you try is what a caller's code would send.
 */
export function TryIt({ method, path, params }: TryItProps) {
  // Prefilled with the catalogue's REAL examples, so the very first click returns a real
  // response — a playground whose first lesson is a 404 teaches distrust, not the API.
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(params.filter((p) => p.example).map((p) => [p.name, p.example!])),
  );
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<TryItResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const valueOf = (p: ApiParam) => (values[p.name] ?? "").trim();

  let built = path;
  for (const p of params.filter((p) => p.kind === "path")) {
    const raw = valueOf(p);
    built = built.replace(`{${p.name}}`, raw === "" ? `{${p.name}}` : encodeURIComponent(raw));
  }
  const query = params
    .filter((p) => p.kind === "query")
    .map((p) => [p.name, valueOf(p)] as const)
    .filter(([, v]) => v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  const url = `${apiBaseUrl}${built}${query ? `?${query}` : ""}`;

  // Every path parameter is required, and so are the windowed analytics' edges: sending without
  // one is a guaranteed 400.
  const missingRequired = params.some((p) => p.required && valueOf(p) === "");

  async function send() {
    setPending(true);
    setFailure(null);
    setResult(null);
    const startedAt = performance.now();
    try {
      const response = await fetch(url, {
        method,
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const text = await response.text();
      let body = text;
      try {
        body = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        // Not JSON (a proxy error page, say) — show it verbatim rather than nothing.
      }
      setResult({
        status: response.status,
        statusText: response.statusText,
        ms: Math.round(performance.now() - startedAt),
        body:
          body.length > MAX_BODY_CHARS ? `${body.slice(0, MAX_BODY_CHARS)}\n… (truncated)` : body,
        contentType: response.headers.get("content-type") ?? "",
      });
    } catch (error) {
      // An honest failure state, not a spinner that gives up silently.
      const message = error instanceof Error ? error.message : String(error);
      setFailure(
        /abort|timeout/i.test(message)
          ? `Timed out after ${TIMEOUT_MS / 1000}s — the API may be unreachable from your network.`
          : `Could not reach the API (${message}). If you are reading this before public launch, the API is not switched on yet — the documentation describes what it will serve.`,
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="panel px-0 py-0">
      <div className="hairline-b flex items-center justify-between px-3 py-2">
        <span className="microlabel">TRY IT</span>
        <span className="text-[10px] tracking-wider text-ink-faint uppercase">
          runs from your browser — this site never sees it
        </span>
      </div>

      <div className="space-y-3 px-3 py-3">
        {params.length > 0 ? (
          <div className="space-y-2">
            {params.map((param) => (
              <label key={param.name} className="block">
                <span className="flex items-baseline gap-1.5">
                  <code className="text-xs text-green">{param.name}</code>
                  <span className="text-[10px] tracking-wider text-ink-faint uppercase">
                    {param.kind}
                    {param.required ? " · required" : ""}
                  </span>
                </span>
                <input
                  type="text"
                  value={values[param.name] ?? ""}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [param.name]: event.target.value }))
                  }
                  placeholder={param.type}
                  spellCheck={false}
                  autoComplete="off"
                  className="mt-1 w-full rounded-sm border border-edge-faint bg-transparent px-2 py-1.5 font-mono text-xs text-ink placeholder:text-ink-faint focus:border-edge-strong focus:outline-none"
                />
              </label>
            ))}
          </div>
        ) : null}

        {/* The exact request, updating as you type. What you see is what is sent — and the
            copy button copies the URL ALONE, without the method verb, because that is the
            string a reader pastes into a browser, a curl or their own code. Copying
            "GET https://..." would make every paste a syntax error. */}
        <div className="flex items-start gap-2 rounded-sm border border-edge-faint px-2 py-1.5">
          <pre className="min-w-0 flex-1 overflow-x-auto text-[11px] leading-relaxed break-all whitespace-pre-wrap text-ink-dim">
            <span className="text-green-dim">{method} </span>
            {url}
          </pre>
          <CopyButton value={url} label={`request URL for ${path}`} />
        </div>

        <button
          type="button"
          onClick={send}
          disabled={pending || missingRequired}
          className="btn btn-primary font-bold tracking-wider"
        >
          {pending ? "SENDING…" : "SEND REQUEST"}
        </button>
        {missingRequired ? (
          <span className="ml-2 text-[11px] text-ink-faint">fill the required parameter first</span>
        ) : null}

        {failure ? (
          <p role="status" className="text-xs leading-relaxed text-warn">
            {failure}
          </p>
        ) : null}

        {result ? (
          <div role="status" className="space-y-1.5">
            <div className="flex items-center gap-3 text-xs">
              <span
                className={result.status < 400 ? "font-bold text-green" : "font-bold text-warn"}
              >
                {result.status} {result.statusText}
              </span>
              <span className="text-ink-faint">{result.ms} ms</span>
            </div>
            <pre className="max-h-80 overflow-x-auto overflow-y-auto rounded-sm border border-edge-faint px-2 py-2 text-[11px] leading-relaxed text-ink-dim">
              {result.body}
            </pre>
          </div>
        ) : null}
      </div>
    </div>
  );
}
