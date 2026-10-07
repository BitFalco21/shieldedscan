import Link from "@/components/Link";
import { FilterPopover } from "@/components/FilterPopover";

export interface ColumnFilterProps {
  options: { value: string; label: string; href: string }[];
  activeValue: string;
  /** Which value means "no filter" — drives the active-state highlight on the icon. */
  neutralValue: string;
  /** Accessible name for the toggle, e.g. "Filter by venue". */
  ariaLabel: string;
}

/**
 * A single-choice filter attached to a table column header.
 *
 * Links inside a `FilterPopover`, which carries the no-JavaScript disclosure and the
 * funnel's applied/not-applied accent. The choice is a URL, the same standard
 * `FilterChips` meets; `aria-current="page"` marks the one in force, which is what
 * `e2e/filters.spec.ts` reads to check that the control and the data agree.
 *
 * For a filter where several values can hold at once, see `ColumnMultiFilter`.
 */
export function ColumnFilter({ options, activeValue, neutralValue, ariaLabel }: ColumnFilterProps) {
  return (
    <FilterPopover ariaLabel={ariaLabel} filtered={activeValue !== neutralValue}>
      {options.map((option) => {
        const active = option.value === activeValue;
        return (
          <Link
            key={option.value}
            href={option.href}
            aria-current={active ? "page" : undefined}
            className={`microlabel rounded-sm px-2 py-1.5 whitespace-nowrap ${
              active ? "text-green" : "text-ink-dim hover:text-green"
            }`}
          >
            {option.label}
          </Link>
        );
      })}
    </FilterPopover>
  );
}
