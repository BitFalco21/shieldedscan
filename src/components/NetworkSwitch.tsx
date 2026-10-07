"use client";

import { usePathname } from "next/navigation";
import { network, siblingUrl, type ZcashNetwork } from "@/lib/network";
import { ICON_MENU_PANEL_CLASS, ICON_MENU_TRIGGER_CLASS, Popover } from "@/components/Popover";

const NETWORKS: readonly ZcashNetwork[] = ["mainnet", "testnet"];

/**
 * The network switcher in the nav: a globe, opening a list of the two deployments.
 *
 * `<details>`/`<summary>` and plain links — no state machine, and each entry is a real URL
 * that can be middle-clicked, copied or bookmarked. A client component only to read the
 * current path, so the switch lands on the same page rather than a homepage.
 *
 * Both networks are always listed, the current one marked `aria-current="true"` and rendered
 * brighter: a single option would make the reader guess which network they are on, and a
 * testnet figure read as mainnet is worse than an outage.
 *
 * Cross-origin links (`<a>`, not `next/link`): the sibling is a different deployment.
 */
export function NetworkSwitch() {
  const pathname = usePathname() ?? "/";
  return (
    <Popover
      triggerLabel={`Network: ${network}. Switch network`}
      triggerTitle={`Network: ${network}`}
      triggerClassName={ICON_MENU_TRIGGER_CLASS}
      panelAs="ul"
      panelClassName={ICON_MENU_PANEL_CLASS}
      panelLabel="Choose network"
      trigger={
        // A globe, drawn rather than typed: JetBrains Mono carries no globe glyph, and a
        // fallback font would size it unpredictably.
        <svg
          viewBox="0 0 16 16"
          width={16}
          height={16}
          aria-hidden
          focusable="false"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.3}
        >
          <circle cx="8" cy="8" r="6.2" />
          <ellipse cx="8" cy="8" rx="2.6" ry="6.2" />
          <path d="M1.9 8h12.2M3 4.4h10M3 11.6h10" />
        </svg>
      }
    >
      {NETWORKS.map((n) => {
        const current = n === network;
        return (
          <li key={n}>
            <a
              href={siblingUrl(pathname, n)}
              aria-current={current ? "true" : undefined}
              className={`block px-3 py-1.5 capitalize ${
                current ? "font-bold text-ink-bright" : "text-ink-dim hover:text-green"
              }`}
            >
              {n}
            </a>
          </li>
        );
      })}
    </Popover>
  );
}
