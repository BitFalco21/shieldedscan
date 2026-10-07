"use client";

import { useEffect, useId, useRef, useState } from "react";
import { SearchSuggestions } from "@/components/SearchSuggestions";
import { useResolvedSuggestions } from "@/lib/use-resolved-suggestions";

/**
 * The hero's input, with the suggestion rows under it.
 *
 * This is a client island INSIDE a plain `<form action="/search">`, not a replacement for
 * it: with JavaScript off the form still submits and `/search` still resolves the query,
 * which is the behaviour the no-JS build has always had. The suggestions are the
 * enhancement, and they are computed locally — see `searchSuggestions` for why nothing is
 * looked up as you type.
 *
 * Keyboard follows the combobox pattern: focus never leaves the input (so typing keeps
 * working), arrows move `aria-activedescendant`, Enter takes the highlighted row or, with
 * nothing highlighted, submits the form exactly as before.
 */
export function HeroSearchBox() {
  const [value, setValue] = useState("");
  const [active, setActive] = useState(-1);
  const [dismissed, setDismissed] = useState(false);
  const listId = useId();

  const { suggestions: resolved, checking } = useResolvedSuggestions(value);
  const suggestions = dismissed ? [] : resolved;
  const rootRef = useRef<HTMLDivElement>(null);
  const open = suggestions.length > 0;

  // A click anywhere else dismisses the rows, like Escape, so mouse users are not trapped with
  // a panel over the stat cards. `pointerdown` rather than `click`, so the dropdown is gone
  // before whatever was underneath receives its click. The listener exists only while the
  // rows are showing.
  useEffect(() => {
    if (!open) return;
    const dismissOutside = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setDismissed(true);
        setActive(-1);
      }
    };
    document.addEventListener("pointerdown", dismissOutside);
    return () => document.removeEventListener("pointerdown", dismissOutside);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <div className="panel prompt-focus flex h-[52px] items-center gap-2.5 px-4 text-sm">
        <span aria-hidden className="whitespace-nowrap text-green">
          zcash&gt;
        </span>
        <input
          type="search"
          name="q"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setActive(-1);
            setDismissed(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" && suggestions.length > 0) {
              event.preventDefault();
              setActive((i) => (i + 1) % suggestions.length);
            } else if (event.key === "ArrowUp" && suggestions.length > 0) {
              event.preventDefault();
              setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
            } else if (event.key === "Escape") {
              setDismissed(true);
              setActive(-1);
            } else if (event.key === "Enter" && active >= 0) {
              // Only intercept when a row is highlighted; otherwise the form submits and
              // /search resolves the query, which is the no-JS path too.
              //
              // Clicks the anchor rather than calling `router.push`: the same code path a mouse
              // click takes, and it keeps `useRouter` out of the homepage tree.
              event.preventDefault();
              document.getElementById(`${listId}-option-${active}`)?.click();
            }
          }}
          // Deliberately not `role="combobox"`: the implicit `searchbox` role is what a screen
          // reader announces for the site's main search, and the list is a supplementary
          // affordance over a form that works without it. No `aria-expanded` either (not
          // supported on searchbox); `aria-activedescendant` and `aria-controls` are, and they
          // carry which option is current and which list it lives in.
          aria-controls={listId}
          aria-activedescendant={active >= 0 ? `${listId}-option-${active}` : undefined}
          autoComplete="off"
          placeholder="search height / txid / address — try a u1 address"
          aria-label="Search the Zcash chain"
          // No outline utilities here: they are layered and LOSE to the unlayered global
          // focus rule. The suppression lives beside that rule in globals.css
          // (`.prompt-focus :focus-visible`), where the cascade actually honours it.
          className="w-full bg-transparent text-ink placeholder:text-ink-faint"
        />
        <button
          type="button"
          data-command-palette-trigger
          aria-label="Open the command palette"
          title="Open the command palette (⌘K)"
          className="flex h-full cursor-pointer items-center px-1"
        >
          <span aria-hidden className="cursor-block" />
        </button>
      </div>
      {/* Absolute so the rows overlay the page rather than pushing the stat cards down as you
          type, and a solid panel so what they overlay does not show through. Rendered only
          when there are rows. */}
      {suggestions.length > 0 && (
        <div className="panel absolute inset-x-0 top-full z-20 mt-1 px-2 py-2 [&>ul]:mt-0">
          <SearchSuggestions
            suggestions={suggestions}
            activeIndex={active}
            onChoose={() => setValue("")}
            id={listId}
            checking={checking}
          />
        </div>
      )}
    </div>
  );
}
