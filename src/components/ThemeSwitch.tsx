"use client";

import { useState, useSyncExternalStore } from "react";
import {
  DEFAULT_THEME,
  THEMES,
  applyTheme,
  readStampedTheme,
  subscribeTheme,
  themeById,
} from "@/lib/theme";
import { ICON_MENU_PANEL_CLASS, ICON_MENU_TRIGGER_CLASS, Popover } from "@/components/Popover";

/**
 * The theme menu in the nav, beside the network switch — the one control on the site that
 * writes to the visitor's browser.
 *
 * Built like `NetworkSwitch`: a `<details data-popover>` whose summary is a drawn palette icon
 * (JetBrains Mono carries no such glyph), opening a right-anchored list. Each entry is a muted
 * dot in that theme's accent whatever the current theme — an offer, not a mirror, painted via
 * `.theme-swatch[data-theme=…]` with `--green-dim`'s recipe — beside the colour's name as
 * visible text. The current entry is `aria-pressed` and brighter, and the summary's spoken
 * name states the current theme.
 *
 * Entries are buttons, not links: a theme is not a place. Choosing stamps `data-theme` on
 * `<html>` and stores the id under a single `localStorage` key; choosing the default removes
 * both. The current theme is read through `useSyncExternalStore` with the default as the server
 * snapshot — the head script stamped the attribute before React ran. All document mutation
 * lives in `lib/theme.ts`. A storage that throws still switches the page and says so.
 */
export function ThemeSwitch() {
  const current = useSyncExternalStore(subscribeTheme, readStampedTheme, () => DEFAULT_THEME);
  const [saveFailed, setSaveFailed] = useState(false);
  const currentLabel = themeById(current).label;

  return (
    <Popover
      triggerLabel={`Theme: ${currentLabel}. Choose theme`}
      triggerTitle={`Theme: ${currentLabel}`}
      triggerClassName={ICON_MENU_TRIGGER_CLASS}
      panelAs="ul"
      panelClassName={ICON_MENU_PANEL_CLASS}
      panelLabel="Choose theme"
      trigger={
        // A palette: a tilted disc with three wells. Drawn, like the globe.
        <svg
          viewBox="0 0 16 16"
          width={16}
          height={16}
          aria-hidden
          focusable="false"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.3}
        >
          <path d="M8 1.8a6.2 6.2 0 1 0 0 12.4c1.3 0 1.7-.8 1.4-1.7-.4-1 .2-1.9 1.3-1.9h1.5c1.1 0 2-.9 2-2A6.2 6.2 0 0 0 8 1.8Z" />
          <circle cx="5.2" cy="8" r="0.9" fill="currentColor" stroke="none" />
          <circle cx="7" cy="4.9" r="0.9" fill="currentColor" stroke="none" />
          <circle cx="10.6" cy="5.4" r="0.9" fill="currentColor" stroke="none" />
        </svg>
      }
    >
      {THEMES.map((t) => {
        const on = t.id === current;
        return (
          <li key={t.id}>
            <button
              type="button"
              aria-pressed={on}
              aria-label={`${t.label} theme`}
              onClick={() => setSaveFailed(!applyTheme(t.id).persisted)}
              className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left ${
                on ? "font-bold text-ink-bright" : "text-ink-dim hover:text-green"
              }`}
            >
              <span
                aria-hidden
                data-theme={t.id}
                className={`theme-swatch inline-block h-2.5 w-2.5 rounded-[2px] ${
                  on ? "ring-2 ring-ink ring-offset-1 ring-offset-panel" : ""
                }`}
              />
              {t.label}
            </button>
          </li>
        );
      })}
      {saveFailed && (
        <li className="px-3 pt-1 pb-1.5 text-xs text-ink-faint" role="status">
          could not save — your browser blocks site data
        </li>
      )}
    </Popover>
  );
}
