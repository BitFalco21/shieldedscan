import type { ReactNode } from "react";

export interface PanelProps {
  /**
   * A node rather than a string, so a title can carry a caveat beside it — the cross-chain
   * external leg appends "not indexed by this explorer" to its heading, which belongs to the
   * whole leg rather than to any one field inside it.
   */
  title?: ReactNode;
  /**
   * A control right after the title and outside the heading — an `InfoTip`, in practice.
   * Inside the `<h2>` its button and tooltip text would become part of the heading's
   * accessible name. The row it shares with the title is the tip's positioned ancestor.
   */
  hint?: ReactNode;
  action?: ReactNode;
  /** Heading level for `title`. Panels sit under the page h1, so 2 is the default. */
  headingLevel?: 2 | 3;
  /**
   * Let the content grow to the panel's full height. Use when panels sit
   * side by side in an equal-height grid and would otherwise end in dead space.
   */
  fill?: boolean;
  /**
   * `regular` (p-5, p-4 on a phone) for a page section; `compact` (px-4 py-3) for a dense box —
   * a stat, a short notice, a panel inside a grid of small ones. Callers choose a density
   * rather than passing padding through `className`.
   */
  density?: "regular" | "compact";
  className?: string;
  children: ReactNode;
}

/**
 * `regular` steps down to 16px below `sm`: at 375px a 20px pad leaves a table too narrow for
 * its key columns. Exported so the loading skeleton matches it exactly.
 */
export const PANEL_PADDING: Record<NonNullable<PanelProps["density"]>, string> = {
  regular: "p-4 sm:p-5",
  compact: "px-4 py-3",
};

/** The terminal panel: bordered, softly lit, with an uppercase green title bar. */
export function Panel({
  title,
  hint,
  action,
  headingLevel = 2,
  fill = false,
  density = "regular",
  className = "",
  children,
}: PanelProps) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <section className={`panel flex flex-col ${PANEL_PADDING[density]} ${className}`.trim()}>
      {title ? (
        <header className="hairline-b mb-3 flex items-center justify-between pb-2.5">
          {hint === undefined ? (
            <Heading className="microlabel text-green">{title}</Heading>
          ) : (
            <div className="relative flex items-center">
              <Heading className="microlabel text-green">{title}</Heading>
              {hint}
            </div>
          )}
          {action}
        </header>
      ) : null}
      {fill ? <div className="min-h-0 flex-1">{children}</div> : children}
    </section>
  );
}
