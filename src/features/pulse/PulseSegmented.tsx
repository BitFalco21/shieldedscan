"use client";

export interface PulseSegmentedProps<T extends string | number> {
  /** The group's accessible name. */
  ariaLabel: string;
  options: readonly T[];
  value: T;
  format: (value: T) => string;
  onChange: (value: T) => void;
}

/**
 * One choice from a closed set, drawn in the stage's own segmented style (`.pulse-seg`). Buttons
 * rather than links: these choose which instant or window is drawn from data already on the page.
 */
export function PulseSegmented<T extends string | number>({
  ariaLabel,
  options,
  value,
  format,
  onChange,
}: PulseSegmentedProps<T>) {
  return (
    <div role="group" aria-label={ariaLabel} className="pulse-seg">
      {options.map((option) => (
        <button
          key={String(option)}
          type="button"
          aria-pressed={option === value}
          onClick={() => onChange(option)}
        >
          {format(option)}
        </button>
      ))}
    </div>
  );
}
