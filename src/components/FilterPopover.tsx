import type { ReactNode } from "react";
import { Popover } from "@/components/Popover";

export interface FilterPopoverProps {
  /** Accessible name for the toggle, e.g. "Filter by venue". */
  ariaLabel: string;
  /** Whether a filter is currently applied — drives the icon's accent. */
  filtered: boolean;
  /**
   * Which edge the panel hangs from. `"right"` opens leftward and suits a column in the
   * middle or at the end of a table; `"left"` opens rightward and is required for the first
   * column, where a right-anchored panel would open off the left edge of a phone screen.
   * That escape adds no scrollWidth, so overflow checks cannot see it.
   */
  align?: "left" | "right";
  /**
   * Which control this is.
   *
   * `"funnel"` (the default) is the table-header filter: it carries its own applied/not-applied
   * colour, because a column header has no other way to show one is in force.
   *
   * `"caret"` is the disclosure on a `FilterChips` chip. It inherits `currentColor` from the
   * chip and ignores `filtered`: the chip is already a lit filter control, so a second state
   * indicator inside it would be two marks for one fact.
   *
   * Both are drawn as SVG rather than typed: JetBrains Mono carries no filter glyph and may lack
   * U+25BE, and a fallback font would size it unpredictably.
   */
  icon?: "funnel" | "caret";
  /**
   * Visible content for the toggle itself, rendered inside the `<summary>` before the icon.
   *
   * Its presence turns the control into a bordered chip: a label needs a hit area, and a caret
   * alone is a ~12px target beside text that looks clickable. Everything inside the summary is
   * the target.
   *
   * Deliberately different from `FilterChips`, where the chip's text is a link and only the
   * caret discloses: those chips have somewhere to navigate to. A control whose label is just
   * the current selection has no such destination, so splitting it would create a dead half.
   *
   * When you pass this, give `ariaLabel` a name that contains the visible text (WCAG 2.5.3):
   * "BTC — choose an asset to compare with", not "Choose an asset".
   */
  label?: ReactNode;
  /** The menu contents; each child should be a link, so choosing works without JS. */
  children: ReactNode;
}

/**
 * The disclosure a table-header filter opens.
 *
 * `<details>`/`<summary>` — no JavaScript, no client component, no state. Opening it works
 * with scripting off, and every choice inside is a URL that can be shared or bookmarked.
 * Filtering is navigation here, not interaction.
 *
 * The icon carries the filter state: accent green when a filter is applied, faint ink when
 * not, so an active filter is visible without opening the menu. A filtered table that looks
 * unfiltered is how a reader concludes the chain is emptier than it is.
 *
 * Anchored to its right edge by default: opening leftward keeps the panel inside the
 * viewport on a phone, where a left-anchored popover in the last columns would push the
 * page sideways. The first column needs the opposite — see `align`.
 *
 * Shared by `ColumnFilter` and the multi-select menus so the chrome, and its accent rule,
 * has one implementation.
 */
export function FilterPopover({
  ariaLabel,
  filtered,
  align = "right",
  icon = "funnel",
  label,
  children,
}: FilterPopoverProps) {
  return (
    <Popover
      triggerLabel={ariaLabel}
      triggerTitle={ariaLabel}
      triggerClassName={`inline-flex cursor-pointer list-none items-center marker:content-none ${
        // A labelled toggle is a chip: the border makes the whole thing read as one target,
        // which is the point of carrying the label in here rather than beside it.
        label === undefined
          ? "rounded-sm p-0.5"
          : "gap-2 rounded-sm border border-edge py-1.5 pr-1.5 pl-3 transition-colors hover:border-edge-strong"
      } ${
        icon === "caret"
          ? "text-current"
          : filtered
            ? "text-green"
            : "text-ink-faint hover:text-ink-dim"
      }`}
      panelClassName={`panel absolute z-30 mt-1 flex max-h-72 min-w-36 flex-col overflow-y-auto p-1 text-left ${
        align === "left" ? "left-0" : "right-0"
      }`}
      trigger={
        <>
          {label}
          {/* See `icon`: drawn rather than typed. */}
          {icon === "caret" ? (
            <svg viewBox="0 0 20 20" aria-hidden className="h-3 w-3" fill="currentColor">
              <path d="M4 7.5h12L10 14.5z" />
            </svg>
          ) : (
            <svg viewBox="0 0 20 20" aria-hidden className="h-3 w-3" fill="currentColor">
              <rect x="2" y="4" width="16" height="1.8" rx="0.9" />
              <rect x="5" y="9" width="10" height="1.8" rx="0.9" />
              <rect x="8" y="14" width="4" height="1.8" rx="0.9" />
            </svg>
          )}
        </>
      }
    >
      {children}
    </Popover>
  );
}
