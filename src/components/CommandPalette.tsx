"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { classifySearchQuery, type SearchQuery } from "@/domain";
import { useResolvedSuggestions } from "@/lib/use-resolved-suggestions";
import { SearchSuggestions } from "@/components/SearchSuggestions";

/**
 * Any element carrying this attribute opens the palette on click — see the
 * search button in SiteNav. A plain data attribute (rather than an imported
 * constant) so a Server Component can use it without importing this "use
 * client" module.
 */
const TRIGGER_SELECTOR = "[data-command-palette-trigger]";

const HINTS: Partial<Record<SearchQuery["type"], string>> = {
  height: "BLOCK HEIGHT",
  hash64: "HASH — BLOCK OR TRANSACTION",
  "transparent-address": "TRANSPARENT ADDRESS",
  "shielded-address": "SHIELDED ADDRESS",
  name: "ZCASH NAME",
  invalid: "NOT RECOGNISED",
};

/** Teaches the Zcash address/height/hash formats as the user types — the palette's
 *  real value over a plain input. Empty input shows no hint yet. */
function classificationHint(query: string): string | null {
  return HINTS[classifySearchQuery(query).type] ?? null;
}

/**
 * Site-wide ⌘K / Ctrl+K search dialog. Mounted once in the root layout.
 *
 * Stores nothing: no search history, no localStorage, no cookies — every
 * keystroke lives only in this component's in-memory state and is gone the
 * moment the dialog closes.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [active, setActive] = useState(-1);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const router = useRouter();

  function openPalette() {
    previouslyFocused.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setValue("");
    setOpen(true);
  }

  function closePalette() {
    setOpen(false);
    previouslyFocused.current?.focus();
  }

  // Global shortcut and click-to-open trigger buttons (e.g. SiteNav's "Search ⌘K").
  // Registered once for the component's lifetime, independent of open/closed state.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        // Stop the browser's own find-in-page/quick-search from firing.
        event.preventDefault();
        openPalette();
      }
    }
    function onClick(event: MouseEvent) {
      if (event.target instanceof Element && event.target.closest(TRIGGER_SELECTOR)) {
        event.preventDefault();
        openPalette();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("click", onClick);
    };
  }, []);

  // While open: focus the input, close on Escape (restoring focus), and keep
  // Tab from leaving the dialog.
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closePalette();
        return;
      }
      if (event.key === "Tab" && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>("input, button");
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  function submit() {
    const query = value.trim();
    if (query === "") return;
    // Reuse the /search route's own resolution and redirect logic — no
    // duplicating height/hash/address classification client-side.
    router.push(`/search?q=${encodeURIComponent(query)}`);
    closePalette();
  }

  // Hooks before the early return: `useResolvedSuggestions` is a hook and must not be called
  // conditionally.
  const { suggestions, checking } = useResolvedSuggestions(value);

  if (!open) return null;

  const hint = classificationHint(value);
  const activeHref = suggestions[active]?.href;

  return (
    <div
      className="scrim fixed inset-0 z-50 flex items-start justify-center px-6 pt-[15vh]"
      onClick={closePalette}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Search the Zcash chain"
        className="panel w-full max-w-md p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2.5">
          <span aria-hidden className="whitespace-nowrap text-green">
            zcash&gt;
          </span>
          <input
            ref={inputRef}
            type="search"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setActive(-1);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" && suggestions.length > 0) {
                event.preventDefault();
                setActive((i) => (i + 1) % suggestions.length);
              } else if (event.key === "ArrowUp" && suggestions.length > 0) {
                event.preventDefault();
                setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
              } else if (event.key === "Enter") {
                event.preventDefault();
                // A highlighted row wins; otherwise fall through to /search, which
                // resolves the query exactly as it did before suggestions existed.
                if (activeHref) {
                  router.push(activeHref);
                  closePalette();
                } else {
                  submit();
                }
              }
            }}
            // Deliberately not `role="combobox"`: overriding the implicit `searchbox` role
            // changes what a screen reader announces for the site's main search. The popup
            // relationship is carried by `aria-activedescendant` and `aria-controls`; the list
            // is a supplementary affordance over a form that works without it.
            // No `aria-expanded`: ARIA supports it on combobox, not on textbox/searchbox.
            aria-controls={listId}
            aria-activedescendant={active >= 0 ? `${listId}-option-${active}` : undefined}
            autoComplete="off"
            placeholder="block height, hash, txid, or address…"
            aria-label="Search the Zcash chain"
            // `focus-visible:outline-none`, not just `outline-none`: browsers apply
            // :focus-visible to text inputs even on mouse focus, and the global
            // `input:focus-visible` rule outranks the base utility. The palette panel is the
            // focus indicator here (WCAG 2.4.7 holds).
            className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint focus-visible:outline-none"
          />
          <button
            type="button"
            onClick={closePalette}
            aria-label="Close search"
            className="cursor-pointer text-ink-faint"
          >
            ✕
          </button>
        </div>
        {/* Live region: the hint teaches the address formats as you type, so screen
            reader users need to hear it change, not only see it. */}
        <p className="microlabel mt-3 min-h-[1em]" role="status" aria-live="polite">
          {hint ?? " "}
        </p>
        <SearchSuggestions
          suggestions={suggestions}
          activeIndex={active}
          onChoose={closePalette}
          id={listId}
          checking={checking}
        />
        <p className="mt-4 text-xs text-ink-faint">
          searches aren&apos;t stored — identifiers resolve against this site only
        </p>
      </div>
    </div>
  );
}
