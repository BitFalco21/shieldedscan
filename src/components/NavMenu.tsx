"use client";

import Link from "@/components/Link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  commandClass,
  isActiveHref,
  isNavGroup,
  NAV_ITEMS,
  type NavLeaf,
} from "@/components/nav-items";
import { usePathname } from "next/navigation";

/**
 * The mobile menu, with every group already expanded rather than nested.
 *
 * A two-level disclosure inside a panel that is itself a disclosure means two taps to reach
 * anything and a menu that grows and shrinks under the thumb. The destinations fit on one
 * screen, so groups become headings.
 */
export function NavMenu() {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();

  /** Close and hand focus back to the toggle, so keyboard users never land on <body>. */
  const close = useCallback(() => {
    setOpen(false);
    buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  const item = (leaf: NavLeaf) => {
    const active = isActiveHref(leaf.href, pathname);
    return (
      <li key={leaf.href}>
        <Link
          href={leaf.href}
          onClick={close}
          aria-current={active ? "page" : undefined}
          className={`block px-2 py-1 ${commandClass(active)}`}
        >
          {leaf.label}
        </Link>
      </li>
    );
  };

  return (
    <div className="lg:hidden">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        aria-expanded={open}
        aria-controls="nav-menu"
        aria-label="Navigation menu"
        className="panel cursor-pointer px-3 py-1.5 text-xs text-ink-dim"
      >
        {open ? "✕" : "☰"}
      </button>
      {open ? (
        <ul
          id="nav-menu"
          className="panel absolute right-6 z-10 mt-2 flex flex-col gap-1 p-3 text-sm"
        >
          {NAV_ITEMS.map((entry) =>
            isNavGroup(entry) ? (
              <li key={entry.label}>
                <div className="microlabel mt-2 px-2 pb-1 first:mt-0">{entry.label}</div>
                <ul className="flex flex-col gap-1">{entry.children.map(item)}</ul>
              </li>
            ) : (
              item(entry)
            ),
          )}
        </ul>
      ) : null}
    </div>
  );
}
