"use client";

import type { ChartRange } from "@/domain";
import { CHART_RANGES } from "@/domain";
import { SegmentedControl } from "@/components/SegmentedControl";

export interface RangeToggleProps {
  value: ChartRange;
  onChange: (range: ChartRange) => void;
}

/**
 * The ALL / 1Y / 180D / 90D / 60D / 30D switch above every time-series chart.
 *
 * Buttons, not links — the opposite of `FilterChips`: a filter changes what the page claims
 * and so must be a shareable URL, while a range only changes how much of one chart's series is
 * in view. The full data is already on the page; toggling stores nothing, fetches nothing, and
 * navigates nowhere. State is conveyed by `aria-pressed` plus the accent, never colour alone.
 */
export function RangeToggle({ value, onChange }: RangeToggleProps) {
  return (
    <SegmentedControl
      options={CHART_RANGES}
      value={value}
      onChange={onChange}
      ariaLabel="Chart time range"
    />
  );
}
