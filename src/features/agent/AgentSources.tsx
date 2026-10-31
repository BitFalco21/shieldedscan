"use client";

import { useId, useState } from "react";
import Link from "@/components/Link";
import type { AgentSource } from "./agent-client";

/**
 * The links an answer was built from, closed until the reader asks for them: the answer is what
 * they came for, and the sources are evidence to open. Same `+`/`−` grammar as the fact-check
 * page's sources.
 *
 * A button with `aria-expanded` rather than a `<details>`, so the open state is announced and
 * the toggle reads the same in every screen reader. The list stays mounted under `hidden` so
 * `aria-controls` always points at an element.
 */

export interface AgentSourcesProps {
  sources: readonly AgentSource[];
}

export function AgentSources({ sources }: AgentSourcesProps) {
  // Per turn: each exchange mounts its own instance, keyed by its id.
  const [open, setOpen] = useState(false);
  const listId = useId();

  return (
    <div className="mt-4 border-t border-edge-faint pt-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
        className="group flex cursor-pointer items-center gap-2 select-none"
      >
        <span className="microlabel text-ink-faint group-hover:text-ink-dim">
          Sources ({sources.length})
        </span>
        <span
          aria-hidden
          className="inline-flex h-5 w-5 items-center justify-center rounded-sm border border-edge text-xs text-green"
        >
          {open ? "−" : "+"}
        </span>
      </button>
      <ul id={listId} hidden={!open} className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {sources.map((source) => (
          <li key={source.href}>
            {/* A new tab — the one place on the site where an internal link gets one. The
                transcript lives only in the console's state, so navigating away in the same tab
                would destroy the conversation the link is evidence for, and the alternative
                would be storing it.

                `noopener` so the new tab cannot reach back through `window.opener`;
                `noreferrer` to match the venue-link rule. */}
            <Link
              href={source.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-green hover:underline"
              prefetch={false}
            >
              <span aria-hidden>↗ </span>
              {source.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
