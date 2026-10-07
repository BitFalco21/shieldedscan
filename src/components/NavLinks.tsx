"use client";

import Link from "@/components/Link";
import { Popover } from "@/components/Popover";
import { usePathname } from "next/navigation";
import {
  commandClass,
  isActiveHref,
  isActiveItem,
  isNavGroup,
  NAV_ITEMS,
  type NavGroup,
} from "@/components/nav-items";

/**
 * The shared `name` that makes the groups an exclusive accordion.
 *
 * Every `<details>` carrying one name lets only one be open at a time, and the browser does
 * the closing — no state, no effect, no document listener — so two group panels never overlap.
 *
 * Distinct from any other `<details>` on the site: table-header popovers are unnamed and must
 * stay independent of the nav.
 */
const NAV_ACCORDION = "nav-group";

/**
 * A group as a `<details>` disclosure — the same no-JavaScript mechanism `ColumnFilter`
 * uses in table headers.
 *
 * Native rather than hand-rolled: `<summary>` is focusable, toggles on Enter and Space, reports
 * expanded/collapsed to a screen reader without ARIA, and with `name` closes its siblings.
 *
 * The `key` on the element in the parent remounts the disclosure whenever the path changes, so
 * a menu never hangs open over the page it just navigated to.
 */
function NavGroupMenu({ group, pathname }: { group: NavGroup; pathname: string }) {
  const active = isActiveItem(group, pathname);
  return (
    <Popover
      name={NAV_ACCORDION}
      className="relative"
      triggerClassName={`cursor-pointer list-none marker:content-none ${commandClass(active)}`}
      trigger={
        <>
          {group.label}
          <span aria-hidden className="ml-1 text-[10px] text-ink-faint">
            ▾
          </span>
        </>
      }
      panelAs="ul"
      panelClassName="panel absolute left-0 z-20 mt-2 flex min-w-44 flex-col gap-1 p-3"
    >
      {group.children.map((child) => {
        const childActive = isActiveHref(child.href, pathname);
        return (
          <li key={child.href}>
            <Link
              href={child.href}
              aria-current={childActive ? "page" : undefined}
              className={`block px-2 py-1 whitespace-nowrap ${commandClass(childActive)}`}
            >
              {child.label}
            </Link>
          </li>
        );
      })}
    </Popover>
  );
}

/**
 * Desktop nav as shell commands: each entry is prefixed "> " and the one matching the
 * current route renders in accent green with `aria-current`. A group highlights when any of
 * its children is active, so a section never looks unvisited from inside it.
 *
 * Client-only because active state needs the pathname; everything else in `SiteNav` stays a
 * Server Component.
 */
export function NavLinks() {
  const pathname = usePathname();
  return (
    // From `lg` (1024px) up only: the bar needs ~956px on one line, and below that it would
    // scroll the page sideways. Below `lg` the menu button carries the nav.
    <span className="hidden gap-5 text-[13px] lg:flex">
      {NAV_ITEMS.map((item) =>
        isNavGroup(item) ? (
          // Remounts on navigation, which collapses the disclosure. Without this the menu
          // stays open across a client-side route change.
          <NavGroupMenu key={`${item.label}:${pathname}`} group={item} pathname={pathname} />
        ) : (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActiveHref(item.href, pathname) ? "page" : undefined}
            className={commandClass(isActiveHref(item.href, pathname))}
          >
            {item.label}
          </Link>
        ),
      )}
    </span>
  );
}
