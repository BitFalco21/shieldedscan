"use client";

import { useState } from "react";
import Link from "@/components/Link";
import { useHydrated } from "@/lib/use-hydrated";
import type { McpToolGroup } from "@/api-catalogue/mcp-tools";

export interface McpToolListProps {
  groups: McpToolGroup[];
}

/**
 * Every tool, grouped as the reference groups its (first) endpoint, each linked to that
 * endpoint's section in `/api-docs`. A filter appears once hydrated; without JavaScript the whole list is
 * simply there.
 */
export function McpToolList({ groups }: McpToolListProps) {
  const hydrated = useHydrated();
  const [query, setQuery] = useState("");
  const total = groups.reduce((n, g) => n + g.tools.length, 0);
  const q = query.trim().toLowerCase();
  const shown = groups
    .map((g) => ({
      ...g,
      tools: q
        ? g.tools.filter((t) => `${t.name} ${t.title} ${g.label}`.toLowerCase().includes(q))
        : g.tools,
    }))
    .filter((g) => g.tools.length > 0);
  const count = shown.reduce((n, g) => n + g.tools.length, 0);

  return (
    <div>
      {hydrated ? (
        <div className="flex flex-wrap items-center gap-3">
          <label className="sr-only" htmlFor="mcp-tool-filter">
            Filter tools
          </label>
          <input
            id="mcp-tool-filter"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="filter: fees, ironwood, nodes…"
            autoComplete="off"
            spellCheck={false}
            className="w-full max-w-sm rounded-sm border border-edge bg-panel px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-green focus:outline-none"
          />
          <span className="text-xs text-ink-faint" aria-live="polite">
            {count === total ? `${total} tools` : `${count} of ${total}`}
          </span>
        </div>
      ) : null}
      {shown.length === 0 ? (
        <p className="mt-6 text-sm text-ink-dim">No tool matches “{query.trim()}”.</p>
      ) : (
        // Columns, not a grid: groups run from 1 tool to 10, and a grid row is as tall as its
        // tallest group, which left most of the page empty. Columns flow and balance.
        <div className="mt-6 gap-x-8 sm:columns-2 lg:columns-3">
          {shown.map((g) => (
            <div key={g.label} className="mb-7 min-w-0 break-inside-avoid">
              <h3 className="text-xs text-ink-faint">{g.label}</h3>
              <ul className="mt-2 space-y-2">
                {g.tools.map((t) => (
                  <li key={t.name} className="min-w-0 leading-snug">
                    <Link
                      href={`/api-docs#${t.docsId}`}
                      className="text-sm break-all text-green hover:underline"
                    >
                      {t.name}
                    </Link>
                    <span className="block text-xs text-ink-dim">{t.title}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
