import type { ReactNode } from "react";
import Link from "@/components/Link";
import { FilterPopover } from "@/components/FilterPopover";

export interface FilterChipOption {
  value: string;
  label: string;
  href: string;
  /**
   * A mark drawn before the label — a client's logo on `/network/nodes`. Decorative: it must be
   * `aria-hidden`, so the chip's accessible name stays its label.
   */
  icon?: ReactNode;
  /**
   * Values this chip owns beyond its own, for the active highlight.
   *
   * `/txs` uses it for MIXED, which stays lit while one of its direction sub-filters is in
   * force. Otherwise the chip row would go dark under `?kind=shielding` — a filtered table
   * whose controls all look unselected.
   */
  ownsValues?: readonly string[];
  /**
   * A dropdown of narrower choices hanging off this chip.
   *
   * The chip's own text stays a link, so the one-click path is unchanged and clicking it from
   * a refined state widens back to the parent; only the caret opens the menu. Same division of
   * labour as a column header and its funnel.
   */
  menu?: {
    ariaLabel: string;
    options: { value: string; label: string; href: string }[];
  };
}

export interface FilterChipsProps {
  options: FilterChipOption[];
  activeValue: string;
  ariaLabel: string;
  /**
   * A visible micro-label before the chips. Optional because a single chip row needs none —
   * the options say what they are. It earns its place when a page carries SEVERAL rows, or
   * when the unit is not self-evident from the values: "≥ $100K" alone reads as today's
   * money, and the figures here are the venue's price AT SWAP.
   */
  label?: string;
}

/**
 * A row of filter links styled like a pill group. Links, not buttons — filtering
 * is navigation: it must work without JS and be shareable as a URL. The active
 * chip gets `aria-current="page"` and the accent-green treatment; inactive
 * chips are dimmed.
 */
export function FilterChips({ options, activeValue, ariaLabel, label }: FilterChipsProps) {
  return (
    <nav aria-label={ariaLabel} className="flex flex-wrap items-center gap-2">
      {label === undefined ? null : <span className="microlabel mr-1 text-ink-faint">{label}</span>}
      {options.map((option) => {
        const active =
          option.value === activeValue || (option.ownsValues?.includes(activeValue) ?? false);
        const tone = active
          ? "border-edge text-green"
          : "border-edge-faint text-ink-faint hover:text-ink-dim";
        if (!option.menu) {
          return (
            <Link
              key={option.value}
              href={option.href}
              aria-current={active ? "page" : undefined}
              className={`microlabel inline-flex items-center gap-1.5 rounded-sm border px-3 py-1 transition-colors ${tone}`}
            >
              {option.icon}
              {option.label}
            </Link>
          );
        }
        return (
          // One pill holding two controls: the label navigates, the caret discloses. The
          // border lives on the wrapper so the pair reads as a single chip.
          <span
            key={option.value}
            className={`microlabel inline-flex items-center gap-1.5 rounded-sm border py-1 pr-1.5 pl-3 transition-colors ${tone}`}
          >
            <Link
              href={option.href}
              aria-current={option.value === activeValue ? "page" : undefined}
              className="transition-colors hover:text-green"
            >
              {option.label}
            </Link>
            <FilterPopover
              ariaLabel={option.menu.ariaLabel}
              filtered={active && option.value !== activeValue}
              /*
               * Left, not the default right: this chip sits early in a row that wraps at 375px,
               * so a right-anchored panel would escape off the left edge, where it adds no
               * scrollWidth and overflow checks cannot see it.
               */
              align="left"
              icon="caret"
            >
              {option.menu.options.map((sub) => {
                const subActive = sub.value === activeValue;
                return (
                  <Link
                    key={sub.value}
                    href={sub.href}
                    aria-current={subActive ? "page" : undefined}
                    className={`microlabel rounded-sm px-2 py-1.5 whitespace-nowrap ${
                      subActive ? "text-green" : "text-ink-dim hover:text-green"
                    }`}
                  >
                    {sub.label}
                  </Link>
                );
              })}
            </FilterPopover>
          </span>
        );
      })}
    </nav>
  );
}
