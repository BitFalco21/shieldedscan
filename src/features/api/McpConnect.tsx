"use client";

import { useEffect, useState } from "react";
import { CopyButton } from "@/components/CopyButton";
import { useHydrated } from "@/lib/use-hydrated";
import type { McpClientSetup } from "./mcp-clients";
import { useRovingTabs } from "./use-roving-tabs";

export interface McpConnectProps {
  clients: McpClientSetup[];
}

/** The tab a `#connect-<id>` hash names, or null. */
function tabFromHash(list: McpClientSetup[]): number | null {
  if (typeof window === "undefined") return null;
  const id = window.location.hash.replace(/^#connect-/, "");
  const i = list.findIndex((c) => c.id === id);
  return i === -1 ? null : i;
}

/**
 * How to connect, one tab per client. Without JavaScript every client's steps render one after
 * another; once hydrated they become tabs (arrow keys move between them).
 */
export function McpConnect({ clients: list }: McpConnectProps) {
  const hydrated = useHydrated();
  // Read once when the tabs first render (a visitor arriving at /mcp#connect-cursor gets Cursor),
  // then kept in step with the hash, so the hero's setup links open the tab they name.
  const [active, setActive] = useState(() => tabFromHash(list) ?? 0);
  useEffect(() => {
    const onHash = () => {
      const i = tabFromHash(list);
      if (i !== null) setActive(i);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [list]);

  const { tabRef, onKeyDown } = useRovingTabs(list.length, active, setActive);

  if (!hydrated) {
    return (
      <div className="space-y-6">
        {list.map((c) => (
          <div key={c.id}>
            <h3 id={`connect-${c.id}`} className="scroll-mt-24 text-sm font-bold text-ink">
              {c.name}
            </h3>
            <Steps client={c} />
          </div>
        ))}
      </div>
    );
  }

  const current = list[active] ?? list[0]!;
  return (
    <div className="panel px-0 py-0">
      <div
        role="tablist"
        aria-label="Assistant"
        onKeyDown={onKeyDown}
        className="hairline-b flex flex-wrap gap-x-1 px-2 pt-2"
      >
        {list.map((c, i) => {
          const selected = i === active;
          return (
            <button
              key={c.id}
              ref={tabRef(i)}
              type="button"
              role="tab"
              id={`connect-${c.id}`}
              aria-selected={selected}
              aria-controls={`mcp-client-panel-${c.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(i)}
              className={
                selected
                  ? "-mb-px cursor-pointer scroll-mt-24 border-b-2 border-green px-3 pb-2 text-sm text-green"
                  : "-mb-px cursor-pointer scroll-mt-24 border-b-2 border-transparent px-3 pb-2 text-sm text-ink-dim hover:text-ink"
              }
            >
              {c.name}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`mcp-client-panel-${current.id}`}
        aria-labelledby={`connect-${current.id}`}
        className="px-4 pt-1 pb-4"
      >
        <Steps client={current} />
      </div>
    </div>
  );
}

function Steps({ client }: { client: McpClientSetup }) {
  return (
    <ol className="mt-3 space-y-3">
      {client.steps.map((s, i) => (
        <li key={i} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2">
          <span className="text-sm text-green-dim tabular-nums">{i + 1}</span>
          <div className="min-w-0">
            <p className="text-sm leading-relaxed text-ink">{s.text}</p>
            {s.copy ? (
              <div className="mt-2 flex items-start justify-between gap-2 rounded-sm border border-edge-faint bg-bg/60 px-3 py-2">
                <pre className="min-w-0 overflow-x-auto text-xs leading-relaxed text-green">
                  {s.copy}
                </pre>
                <CopyButton value={s.copy} label={`${client.name} setup`} />
              </div>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
