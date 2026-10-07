import type { ReactNode } from "react";
import { ZNS_SITE_URL, znsExplorerHref } from "@/lib/links";

export interface ZnsExplorerChipProps {
  /** A bare registry name, deep-linked into their explorer; null links their homepage. */
  name: string | null;
  children: ReactNode;
}

/**
 * The one way off this site to the Zcash Name System, drawn in the site's primary-action look
 * (`.btn-primary`): a green chip. Used wherever a reader's next step is at zcashnames.com —
 * buying a listed name, or seeing a name nobody has registered. A new tab, and `noreferrer` so the
 * registry is not told which page sent the visitor. Nothing is bought or claimed here.
 */
export function ZnsExplorerChip({ name, children }: ZnsExplorerChipProps) {
  return (
    <a
      data-zns-explorer
      href={name === null ? ZNS_SITE_URL : znsExplorerHref(name)}
      target="_blank"
      rel="noopener noreferrer"
      className="btn btn-primary inline-flex items-center gap-1.5 text-sm whitespace-nowrap"
    >
      {children} <span aria-hidden="true">↗</span>
    </a>
  );
}
