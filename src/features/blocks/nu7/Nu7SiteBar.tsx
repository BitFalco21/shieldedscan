"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { NU7_HEIGHT } from "@/domain";
import Link from "@/components/Link";
import { isTestnet } from "@/lib/network";
import { useTipFeed } from "@/lib/use-tip-feed";
import { Nu7BarLine } from "./Nu7BarLine";
import { Nu7MiniBeat } from "./Nu7MiniBeat";
import { nu7BarText } from "./nu7-bar";

export interface Nu7SiteBarProps {
  /** Test seam: the deployment's network is a build constant everywhere else. */
  testnet?: boolean;
}

/**
 * Once a minute: every page view runs this, and the endpoint is CDN-shared, so a slow cadence
 * keeps it to about one origin request per minute site-wide.
 */
const POLL_MS = 60_000;

const COUNTDOWN_PATH = `/block/${NU7_HEIGHT}`;

/**
 * Where the bar stays away: the countdown itself, and the agent console, which is sized to the
 * viewport, so a bar above it would make the page scroll under the reader.
 */
const HIDDEN_ON = new Set([COUNTDOWN_PATH, "/ai-agent"]);

/**
 * A one-line bar above the nav that sends readers to the NU7 countdown, then for a day says the
 * upgrade is live. Temporary: delete this folder's bar files and its line in the root layout.
 *
 * The server renders the static line, so the bar's box is there from the first paint; the first
 * read fills in the counts. A failed read keeps the static line. The × hides it for this page
 * view only: nothing is stored, so it is back on the next load.
 */
export function Nu7SiteBar({ testnet = isTestnet }: Nu7SiteBarProps) {
  const pathname = usePathname();
  const [closed, setClosed] = useState(false);
  // Latched: once the live window is over, the bar stops polling for the rest of the view.
  const [over, setOver] = useState(false);
  const shown = !testnet && !closed && !over && !HIDDEN_ON.has(pathname);
  const feed = useTipFeed(POLL_MS, shown);
  if (!shown) return null;

  const text = nu7BarText(feed.tip, feed.blocks, feed.readAt);
  if (text.kind === "over") {
    setOver(true);
    return null;
  }

  return (
    <div className="flex min-h-11 items-center gap-2.5 border-b border-green-faint bg-linear-to-r from-warn-wash to-transparent pl-3.5 text-[13px] sm:pl-6">
      <Link
        href={COUNTDOWN_PATH}
        className="group flex min-w-0 flex-1 items-center gap-2.5 whitespace-nowrap text-ink no-underline"
      >
        <Nu7MiniBeat active={text.kind === "live"} />
        <span className="font-bold text-warn">nu7&gt;</span>
        <span className="min-w-0 truncate">
          <Nu7BarLine text={text} />
        </span>
        <span
          aria-hidden="true"
          className="text-green transition-transform group-hover:translate-x-[3px]"
        >
          →
        </span>
      </Link>
      <button
        type="button"
        onClick={() => setClosed(true)}
        aria-label="Hide for this page view"
        className="size-11 shrink-0 text-lg text-ink-faint hover:text-ink-bright"
      >
        ×
      </button>
    </div>
  );
}
