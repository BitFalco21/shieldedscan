"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { ecosystemHost, type EcosystemEntry } from "@/domain/ecosystem";
import { initial } from "./layout";
import { categoryLabel, searchEntries } from "./search";

export interface StageSearchProps {
  entries: readonly EcosystemEntry[];
  logos: ReadonlySet<string>;
  onPick: (id: string) => void;
  onClose: () => void;
}

const LIMIT = 8;

/**
 * The map's search bar: type, and the matching projects appear beneath; arrow keys move, Enter
 * or a click flies the camera to the project. A combobox in the ARIA sense — `aria-expanded`,
 * `aria-controls` and `aria-activedescendant` on the input — so a screen reader hears the list
 * and the current option. It searches this page's projects only; the chain search stays ⌘K.
 */
export function StageSearch({ entries, logos, onPick, onClose }: StageSearchProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const results = searchEntries(entries, query, LIMIT);
  const open = results.length > 0;

  useEffect(() => input.current?.focus(), []);

  const pick = (e: EcosystemEntry | undefined) => {
    if (e) onPick(e.id);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (results.length ? (a + 1) % results.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (results.length ? (a - 1 + results.length) % results.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(results[active] ?? results[0]);
    }
  };

  return (
    <div className="eco-search">
      <input
        ref={input}
        type="text"
        role="combobox"
        aria-label="Search projects"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        placeholder="Search projects by name, site or category"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={onKey}
        className="w-full bg-transparent px-4 py-3 text-sm text-ink outline-none placeholder:text-ink-faint"
      />
      <ul
        id={listId}
        role="listbox"
        aria-label="Matching projects"
        className={open ? "border-t border-edge-faint py-1" : "hidden"}
      >
        {results.map((e, i) => (
          <li
            key={e.id}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === active}
            onPointerDown={(ev) => ev.preventDefault()}
            onClick={() => pick(e)}
            onPointerEnter={() => setActive(i)}
            className={`flex cursor-pointer items-center gap-3 px-4 py-2 text-sm ${
              i === active ? "bg-green-wash-strong text-ink-bright" : "text-ink"
            }`}
          >
            {logos.has(e.id) ? (
              // A committed 64px icon from our own origin; next/image would add a loader round
              // trip for a file already the size it renders at.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/ecosystem/logos/${e.id}.png`}
                alt=""
                width={20}
                height={20}
                className="shrink-0 rounded-sm"
              />
            ) : (
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-edge text-[10px] font-bold">
                {initial(e.name)}
              </span>
            )}
            <span className="min-w-0 flex-1 truncate">{e.name}</span>
            <span className="hidden shrink-0 text-xs text-ink-faint sm:inline">
              {categoryLabel(e.category)} · {ecosystemHost(e.url)}
            </span>
          </li>
        ))}
      </ul>
      {query.trim() && !open ? (
        <p className="border-t border-edge-faint px-4 py-2 text-xs text-ink-faint">
          No project matches “{query.trim()}”.
        </p>
      ) : null}
    </div>
  );
}
