"use client";

import { usePathname } from "next/navigation";
import { ZnsExplorerChip } from "@/components/ZnsExplorerChip";
import { parseZnsName } from "@/domain";

/**
 * The 404's link to zcashnames.com, deep-linked to the name in the URL. A `not-found.tsx` receives
 * no route params, so the name is read from the pathname. A path that is not a valid name
 * (`/name/Not_A_Name`) links their homepage instead: there is nothing to filter by.
 *
 * Not in the server HTML, and neither is the rest of this 404: a dynamic route's not-found page
 * arrives as RSC payload and renders in the browser, so the chip is present exactly when the
 * heading is.
 */
export function NotFoundExplorerChip() {
  const segment = usePathname()?.split("/")[2] ?? "";
  let name: string | null = null;
  try {
    name = parseZnsName(decodeURIComponent(segment));
  } catch {
    // A malformed percent-escape is not a name.
  }
  return name === null ? (
    <ZnsExplorerChip name={null}>visit zcashnames.com</ZnsExplorerChip>
  ) : (
    <ZnsExplorerChip name={name}>see it on zcashnames.com</ZnsExplorerChip>
  );
}
