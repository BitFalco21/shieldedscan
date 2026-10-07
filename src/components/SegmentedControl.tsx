"use client";

import type { ReactNode } from "react";

export interface SegmentedControlOption<T extends string> {
  value: T;
  label: ReactNode;
}

export interface SegmentedControlProps<T extends string> {
  /** The choices, in display order. */
  options: readonly SegmentedControlOption<T>[];
  /** The selected value. */
  value: T;
  onChange: (value: T) => void;
  /** The group's accessible name, e.g. "Chart time range". */
  ariaLabel: string;
  /** A visible label rendered inside the group, before the buttons. */
  prefix?: ReactNode;
  /** Classes on the group. Default `flex flex-wrap gap-1.5`. */
  className?: string;
}

/**
 * A row of buttons choosing one value from a closed set, for a view that changes what is on
 * screen without changing what the page claims (a chart range, a sort order, a lens). A choice
 * that should be shareable is a link instead, as in `FilterChips`.
 *
 * State is conveyed by `aria-pressed` plus the accent, never colour alone.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  prefix,
  className = "flex flex-wrap gap-1.5",
}: SegmentedControlProps<T>) {
  return (
    <div role="group" aria-label={ariaLabel} className={className}>
      {prefix}
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={`microlabel cursor-pointer rounded-sm border px-2 py-0.5 transition-colors ${
              active
                ? "border-edge text-green"
                : "border-edge-faint text-ink-faint hover:text-ink-dim"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
