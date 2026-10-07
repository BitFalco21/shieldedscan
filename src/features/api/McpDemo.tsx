"use client";

import { useState, type ReactNode } from "react";
import { CopyButton } from "@/components/CopyButton";
import { useHydrated } from "@/lib/use-hydrated";
import type { McpExchange } from "./mcp-demo";
import { useRovingTabs } from "./use-roving-tabs";

export interface McpDemoProps {
  exchanges: McpExchange[];
}

/**
 * The `/mcp` hero: what an assistant does with this server, shown rather than described. Pick a
 * question; see the tool it calls, an excerpt of what came back, and an answer built from it.
 *
 * Progressive: without JavaScript every exchange renders, stacked and readable; once hydrated they
 * collapse into tabs (ARIA tab pattern, arrow keys move between them). No typing effect and no
 * motion: switching is instant.
 */
export function McpDemo({ exchanges }: McpDemoProps) {
  const hydrated = useHydrated();
  const [active, setActive] = useState(0);
  const { tabRef, onKeyDown } = useRovingTabs(exchanges.length, active, setActive);

  if (!hydrated) {
    return (
      <div className="space-y-4">
        {exchanges.map((x) => (
          <Transcript key={x.id} exchange={x} />
        ))}
      </div>
    );
  }

  return (
    <div>
      <div
        role="tablist"
        aria-label="Example questions"
        onKeyDown={onKeyDown}
        className="flex flex-wrap gap-1.5"
      >
        {exchanges.map((x, i) => {
          const selected = i === active;
          return (
            <button
              key={x.id}
              ref={tabRef(i)}
              type="button"
              role="tab"
              id={`mcp-demo-tab-${x.id}`}
              aria-selected={selected}
              aria-controls={`mcp-demo-panel-${x.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(i)}
              className={
                selected
                  ? "cursor-pointer rounded-sm border border-edge bg-green-wash-strong px-3 py-1.5 text-sm text-green"
                  : "cursor-pointer rounded-sm border border-edge-faint px-3 py-1.5 text-sm text-ink-dim hover:text-ink"
              }
            >
              {x.topic}
            </button>
          );
        })}
      </div>
      {/*
        Every transcript sits in the SAME grid cell and only the active one is visible, so the
        cell is as tall as the tallest answer: switching tabs never resizes the box or moves the
        page below it. `invisible` (visibility: hidden) also takes the others out of the
        accessibility tree, so a screen reader meets only the selected panel.
      */}
      <div className="mt-3 grid">
        {exchanges.map((x, i) => (
          <div
            key={x.id}
            role="tabpanel"
            id={`mcp-demo-panel-${x.id}`}
            aria-labelledby={`mcp-demo-tab-${x.id}`}
            inert={i !== active}
            className={i === active ? "[grid-area:1/1]" : "invisible [grid-area:1/1]"}
          >
            <Transcript exchange={x} />
          </div>
        ))}
      </div>
    </div>
  );
}

function Transcript({ exchange: x }: { exchange: McpExchange }) {
  // One argument per line, as a client logs a call: a long call on one line wraps mid-value
  // ("2026-10-" / "01"), which reads as two different dates.
  const entries = Object.entries(x.args);
  const call =
    entries.length === 0
      ? `${x.tool}()`
      : `${x.tool}({\n${entries.map(([k, v]) => `  ${k}: "${v}"`).join(",\n")}\n})`;
  return (
    <figure className="panel h-full px-0 py-0">
      <figcaption className="hairline-b flex items-center justify-between gap-3 px-4 py-2 text-xs text-ink-faint">
        <span>your assistant</span>
        <span className="text-green-dim">shieldedscan mcp</span>
      </figcaption>
      <dl className="divide-y divide-edge-faint">
        <Row label="asks">
          <div className="flex items-start justify-between gap-3">
            <p className="text-base leading-snug text-ink-bright">{x.question}</p>
            <CopyButton value={x.question} label="question" />
          </div>
        </Row>
        <Row label="calls">
          <pre className="overflow-x-auto text-sm leading-relaxed text-green">{call}</pre>
        </Row>
        <Row label="gets">
          <pre className="overflow-x-auto text-xs leading-relaxed text-ink-dim">{x.excerpt}</pre>
        </Row>
        <Row label="answers">
          <p className="text-sm leading-relaxed text-ink">{x.answer}</p>
        </Row>
      </dl>
    </figure>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 px-4 py-3 sm:grid-cols-[5.5rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-xs text-ink-faint sm:pt-0.5">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}
