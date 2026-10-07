import type { ReactNode } from "react";
import Link from "@/components/Link";
import { FilterPopover } from "@/components/FilterPopover";

export interface ColumnMultiFilterOption {
  value: string;
  label: string;
  /** Where choosing this option leads — the state with `value` toggled on or off. */
  href: string;
  selected: boolean;
  /**
   * A mark rendered before the label — the chain's own logo, in practice. A `ReactNode`
   * rather than a ticker, so this component keeps knowing nothing about brands or domains.
   * Decorative: the label is what carries the meaning, and the mark must be `aria-hidden`,
   * which `ChainLogo` already is.
   */
  icon?: ReactNode;
}

export interface ColumnMultiFilterProps {
  options: ColumnMultiFilterOption[];
  /** Where "everything" leads; rendered as the first row and dimmed when nothing is chosen. */
  clearHref: string;
  /** Accessible name for the toggle, e.g. "Filter by source chain". */
  ariaLabel: string;
  /** Which edge the panel hangs from; the first column in a table needs `"left"`. */
  align?: "left" | "right";
  /**
   * How one option is described to a screen reader — "BTC as a source chain", say. The
   * verb is supplied here, so the label reads "Add BTC as a source chain".
   */
  describeOption: (label: string) => string;
}

/**
 * A filter attached to a column header where several values can hold at once.
 *
 * Each row is a link to the state with that value toggled, not a checkbox in a form: the
 * whole selection stays in the URL, so it is shareable, survives paging, works with
 * scripting off, and needs no submit button.
 *
 * State is drawn as `[x]` / `[ ]`: ASCII cannot be a glyph missing from JetBrains Mono, and it
 * reads as a terminal checkbox.
 *
 * No `aria-current`: that means "you are here", and a selected value is not a destination.
 * Each link carries an explicit "Add …"/"Remove …" label; the `[x]` marker is redundant
 * reinforcement for a sighted reader.
 */
export function ColumnMultiFilter({
  options,
  clearHref,
  ariaLabel,
  align,
  describeOption,
}: ColumnMultiFilterProps) {
  const anySelected = options.some((o) => o.selected);
  return (
    <FilterPopover ariaLabel={ariaLabel} filtered={anySelected} align={align}>
      <Link
        href={clearHref}
        aria-disabled={anySelected ? undefined : true}
        className={`microlabel hairline-b rounded-sm px-2 py-1.5 whitespace-nowrap ${
          anySelected ? "text-ink-dim hover:text-green" : "text-ink-faint"
        }`}
      >
        ALL CHAINS
      </Link>
      {options.map((option) => (
        <Link
          key={option.value}
          href={option.href}
          aria-label={`${option.selected ? "Remove" : "Add"} ${describeOption(option.label)}`}
          className={`microlabel flex items-center gap-1.5 rounded-sm px-2 py-1.5 whitespace-nowrap ${
            option.selected ? "text-green" : "text-ink-dim hover:text-green"
          }`}
        >
          <span aria-hidden>{option.selected ? "[x]" : "[ ]"}</span>
          {option.icon}
          {option.label}
        </Link>
      ))}
    </FilterPopover>
  );
}
