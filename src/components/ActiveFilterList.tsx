import type { ReactNode } from "react";
import Link from "@/components/Link";

export interface ActiveFilterGroup {
  /** What the values narrow, e.g. "SOURCE". */
  label: string;
  /**
   * Each selected value, with the href that removes it and an optional decorative mark
   * rendered before the label. A `ReactNode` rather than a ticker keeps this component
   * ignorant of brands, exactly like `ColumnMultiFilter`.
   */
  values: { label: string; removeHref: string; icon?: ReactNode }[];
}

export interface ActiveFilterListProps {
  groups: ActiveFilterGroup[];
  /** Where "clear everything" leads. */
  clearHref: string;
  ariaLabel: string;
}

/**
 * The selections currently narrowing a list, each removable in one click.
 *
 * A multi-select can hide several chains behind one green funnel, and a filtered table whose
 * filter is invisible reads as data emptier than it is. This line names what is applied.
 *
 * Renders nothing when nothing is selected. Every chip is a link, like every other filter
 * control here.
 */
export function ActiveFilterList({ groups, clearHref, ariaLabel }: ActiveFilterListProps) {
  const active = groups.filter((g) => g.values.length > 0);
  if (active.length === 0) return null;
  return (
    <nav aria-label={ariaLabel} className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {active.map((group) => (
        <span key={group.label} className="flex flex-wrap items-center gap-1.5">
          <span className="microlabel text-ink-faint">{group.label}</span>
          {group.values.map((value) => (
            <Link
              key={value.label}
              href={value.removeHref}
              aria-label={`Remove ${value.label} from ${group.label.toLowerCase()}`}
              className="microlabel inline-flex items-center gap-1.5 rounded-sm border border-edge px-2 py-1 text-green hover:border-edge-strong hover:text-ink-bright"
            >
              {value.icon}
              {value.label}
              {/* Drawn, not typed: a mono font's coverage of ✕/×/⨯ is not something to bet a
                  control on. */}
              <svg viewBox="0 0 10 10" aria-hidden className="h-2 w-2 text-ink-faint">
                <path
                  d="M1 1 L9 9 M9 1 L1 9"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
            </Link>
          ))}
        </span>
      ))}
      <Link
        href={clearHref}
        className="microlabel text-ink-faint underline-offset-4 hover:text-ink-dim hover:underline"
      >
        clear
      </Link>
    </nav>
  );
}
