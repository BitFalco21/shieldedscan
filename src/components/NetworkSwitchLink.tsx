"use client";

import { usePathname } from "next/navigation";
import { siblingNetworkName, siblingUrl } from "@/lib/network";

export interface NetworkSwitchLinkProps {
  className?: string;
  children: React.ReactNode;
}

/**
 * The network toggle: a plain link that swaps the HOSTNAME — never a client-side data switch,
 * which is how testnet figures would end up rendered by a mainnet page.
 *
 * It keeps the current path where the sibling deployment has the route (`siblingUrl`), and
 * lands on the sibling's homepage from a mainnet-only page. The query string is dropped:
 * cursors and filters encode positions in one chain's data.
 */
export function NetworkSwitchLink({ className, children }: NetworkSwitchLinkProps) {
  const pathname = usePathname() ?? "/";
  // `siblingUrl` is shared with the nav's NetworkSwitch, so the two controls agree on where
  // "the same page" is.
  return (
    <a href={siblingUrl(pathname, siblingNetworkName)} className={className}>
      {children}
    </a>
  );
}
