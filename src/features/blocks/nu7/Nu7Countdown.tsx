"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { NU7_HEIGHT, type BlockSummary } from "@/domain";
import Link from "@/components/Link";
import { formatCount, formatUtc, timeAgo } from "@/lib/format";
import { useDisplayNow } from "@/lib/use-display-now";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import { useTipFeed } from "@/lib/use-tip-feed";
import { Nu7Changes } from "./Nu7Changes";
import { Nu7Heartbeat } from "./Nu7Heartbeat";
import { markNu7Watched } from "./nu7-arrival";
import {
  activationEtaSeconds,
  blocksToGo,
  formatRemaining,
  initialPhase,
  mergeRecent,
  nextPhase,
  type CountdownPhase,
} from "./nu7-countdown";

export interface Nu7CountdownProps {
  /** The chain tip the server rendered against: the first paint, and the no-JavaScript page. */
  tipHeight: number;
  tipTimestamp: number;
  /** The newest blocks at render, newest first. */
  recent: readonly BlockSummary[];
}

/** The live lists' cadence; the endpoint is CDN-shared, so most polls never reach the origin. */
const POLL_MS = 10_000;
/** How long the activation holds before the page asks the server for the real block. */
export const NU7_ACTIVATION_MS = 5_000;
/**
 * Asking the server for the block once the tip has passed it: brisk for a minute, then slow.
 * Each refresh is an uncached render, and every open countdown crosses the height together, so
 * the waits are jittered to spread them.
 */
const REFRESH_FAST_MS = 4_000;
const REFRESH_SLOW_MS = 30_000;
const REFRESH_JITTER_MS = 2_000;
const FAST_REFRESHES = 12;
/** Past this the ETA prints its date, not only a clock time. */
const SAME_DAY_SECONDS = 20 * 3_600;

/**
 * The countdown on the activation block's own page, until the block exists.
 *
 * Seeded by the server and then fed by `/api/live`. When the tip reaches the height it shows
 * the activation, then refreshes the route until the server renders the real block. A failed
 * poll keeps the last values and says it is reconnecting; nothing here is a substitute figure.
 */
export function Nu7Countdown({ tipHeight, tipTimestamp, recent }: Nu7CountdownProps) {
  const router = useRouter();
  const reducedMotion = usePrefersReducedMotion();
  const feed = useTipFeed(POLL_MS);
  const tipNow = feed.tip?.height ?? tipHeight;
  const tipTime = feed.tip?.lastBlockTimestamp ?? tipTimestamp;

  // Folded once per poll, during render: React's pattern for state derived from a changing
  // input, so a stale trace never paints.
  const [blocks, setBlocks] = useState<BlockSummary[]>(() => mergeRecent([], recent, tipHeight));
  const [foldedAt, setFoldedAt] = useState(0);
  if (feed.tip !== null && feed.readAt !== foldedAt) {
    setFoldedAt(feed.readAt);
    setBlocks(mergeRecent(blocks, feed.blocks, feed.tip.height));
  }

  // `watched`: the tip crossed the height while this page was open, rather than before it loaded.
  const [{ phase, watched }, setProgress] = useState<{ phase: CountdownPhase; watched: boolean }>(
    () => ({ phase: initialPhase(tipHeight), watched: false }),
  );
  const next = nextPhase(phase, tipNow, reducedMotion);
  if (next !== phase) setProgress({ phase: next, watched: true });

  useEffect(() => {
    if (phase !== "activating") return;
    const timer = setTimeout(
      () => setProgress((p) => ({ ...p, phase: "awaiting" })),
      NU7_ACTIVATION_MS,
    );
    return () => clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (phase !== "awaiting") return;
    if (watched) markNu7Watched();
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      router.refresh();
      attempts += 1;
      const base = attempts < FAST_REFRESHES ? REFRESH_FAST_MS : REFRESH_SLOW_MS;
      timer = setTimeout(refresh, base + Math.random() * REFRESH_JITTER_MS);
    };
    refresh();
    return () => clearTimeout(timer);
  }, [phase, watched, router]);

  // The figure ticks when a block arrives, not on the first paint.
  const [initialToGo] = useState(() => blocksToGo(tipHeight));
  const now = useDisplayNow(tipTimestamp);
  const toGo = blocksToGo(tipNow);
  const active = phase !== "counting";
  const eta = activationEtaSeconds(tipNow, tipTime);
  const remaining = formatRemaining(eta - now);
  const clock = eta - now > SAME_DAY_SECONDS ? formatUtc(eta) : `~${formatUtc(eta).slice(11)}`;

  return (
    <>
      <div className="mt-6 grid items-end gap-x-10 gap-y-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div>
          <div
            key={toGo}
            aria-live="polite"
            className={`nu7-count font-extrabold ${active ? "text-warn" : "text-green"} ${
              toGo === initialToGo ? "" : "nu7-tick"
            }`}
          >
            {formatCount(toGo)}
          </div>
          <p className="mt-2 text-ink-dim">
            <b className="text-ink-bright">blocks to go</b>
            {active ? null : (
              <>
                {" "}
                · est. {clock}, {remaining === null ? "any moment" : `in about ${remaining}`}
              </>
            )}
          </p>
        </div>
        <Nu7Changes active={active} />
      </div>

      <Nu7Heartbeat blocks={blocks} tipHeight={tipNow} tipTimestamp={tipTime} />

      <p className="mt-5 flex flex-wrap gap-x-6.5 gap-y-2 text-[13px] text-ink-dim">
        {feed.reconnecting ? (
          <span role="status" className="text-warn">
            ○ reconnecting
          </span>
        ) : (
          <span className="text-green">
            <span aria-hidden="true" className="nu7-live-dot mr-1.5 inline-block">
              ●
            </span>
            live
          </span>
        )}
        <span>
          <span className="text-ink-faint">latest</span>{" "}
          <Link href={`/block/${tipNow}`} className="text-green">
            #{formatCount(tipNow)}
          </Link>{" "}
          · mined {timeAgo(tipTime, now)}
        </span>
      </p>

      {active ? (
        <p role="status" className="mt-4 min-h-[1.4em] text-[13px] text-ink-dim">
          <span className="text-warn">&gt;</span> block {formatCount(NU7_HEIGHT)} mined · NU7 is
          active
          {phase === "awaiting" ? <span className="ml-3 text-ink-faint">activating…</span> : null}
        </p>
      ) : null}
    </>
  );
}
