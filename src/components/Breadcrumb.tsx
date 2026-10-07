import { Fragment, type ReactNode } from "react";
import Link from "@/components/Link";

export interface BreadcrumbItem {
  /** A node, so the current crumb can carry a mark — the shielded-address page's shield. */
  label: ReactNode;
  /** Omit for the current page, which is the last item and is not a link. */
  href?: string;
}

export interface BreadcrumbProps {
  items: readonly BreadcrumbItem[];
}

/**
 * The trail above a detail page's title — `HOME / BLOCKS / #3,428,150`.
 *
 * One micro-label line, linked crumbs underlined on hover, separators as real ` / ` text so a
 * copied trail reads as one. A `<nav>` with its own name, so a screen reader can tell it from
 * the site's navigation.
 */
export function Breadcrumb({ items }: BreadcrumbProps) {
  const last = items.length - 1;
  return (
    <nav aria-label="Breadcrumb" className="microlabel">
      {items.map((item, index) => (
        <Fragment key={index}>
          {index > 0 ? " / " : null}
          {item.href === undefined ? (
            <span aria-current={index === last ? "page" : undefined}>{item.label}</span>
          ) : (
            <Link href={item.href} className="hover:underline">
              {item.label}
            </Link>
          )}
        </Fragment>
      ))}
    </nav>
  );
}
