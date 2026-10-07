import type { ReactNode } from "react";

/** The trigger of an icon-only nav menu (the network and theme switches). */
export const ICON_MENU_TRIGGER_CLASS =
  "inline-flex cursor-pointer list-none items-center rounded-sm p-1 text-ink-dim marker:content-none hover:text-green";

/** The panel of an icon-only nav menu, anchored to its right edge. */
export const ICON_MENU_PANEL_CLASS = "panel absolute right-0 z-30 mt-2 min-w-[9rem] py-1 text-sm";

export interface PopoverProps {
  /** What the toggle shows. */
  trigger: ReactNode;
  /** Classes on the `<summary>`; include `list-none marker:content-none` to hide the marker. */
  triggerClassName: string;
  /** Spoken name of the toggle, required when it shows only an icon. */
  triggerLabel?: string;
  /** Tooltip on the toggle. */
  triggerTitle?: string;
  /** Classes on the panel. */
  panelClassName: string;
  /** The panel element: a `ul` when the entries are list items. Default `div`. */
  panelAs?: "div" | "ul";
  /** Spoken name of the panel. */
  panelLabel?: string;
  /** Disclosures sharing a name form an exclusive accordion: opening one closes the others. */
  name?: string;
  /** Classes on the `<details>`. Default `relative inline-block align-middle`. */
  className?: string;
  children: ReactNode;
}

/**
 * A menu that opens from a toggle, built on `<details>`/`<summary>`: no JavaScript and no state.
 * The summary is focusable, toggles on Enter and Space, and reports expanded or collapsed to a
 * screen reader by itself, and the menu works with scripting off.
 *
 * `data-popover` opts it in to `DismissPopovers`, which closes it on an outside click or Escape.
 * Content disclosures (a raw hex dump, extra facts) are plain `<details>` and stay open.
 */
export function Popover({
  trigger,
  triggerClassName,
  triggerLabel,
  triggerTitle,
  panelClassName,
  panelAs = "div",
  panelLabel,
  name,
  className = "relative inline-block align-middle",
  children,
}: PopoverProps) {
  const Panel = panelAs;
  return (
    <details data-popover name={name} className={className}>
      <summary aria-label={triggerLabel} title={triggerTitle} className={triggerClassName}>
        {trigger}
      </summary>
      <Panel className={panelClassName} aria-label={panelLabel}>
        {children}
      </Panel>
    </details>
  );
}
