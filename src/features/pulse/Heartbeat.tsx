"use client";

import { useState } from "react";
import type { PulseBlock } from "@/domain";
import { formatCount } from "@/lib/format";

export interface HeartbeatProps {
  /** Oldest first. Only the tail is drawn. */
  blocks: readonly PulseBlock[];
  /**
   * Seconds since the newest block arrived, for the bar that is still growing. Null while polls
   * are failing: otherwise the bar becomes a clock measuring our own outage.
   */
  liveSeconds: number | null;
  /** Three consecutive failed polls. The strip says so rather than going quietly still. */
  unavailable: boolean;
}

const W = 420;
const H = 44;
/** Zcash's post-Blossom target. The line every bar is read against. */
const TARGET_SECONDS = 75;
/** Where the top of the strip sits, in seconds. A slower block is clipped rather than rescaled. */
const CEILING_SECONDS = 150;
/** The most bars drawn; also the fewest slots laid out, so a short frame is not stretched wide. */
const MAX_BARS = 40;
const MIN_SLOTS = 12;

const scale = (seconds: number): number => Math.min(H, (seconds * (H - 8)) / CEILING_SECONDS);

function barReading(block: PulseBlock): string {
  const height = formatCount(block.pools.height);
  if (block.intervalSeconds === null) return `block ${height} · arrival not recorded`;
  const late = block.indexedLate === true ? " · indexed late" : "";
  return `block ${height} · ${Math.round(block.intervalSeconds)} s after the previous block reached our node${late}`;
}

/**
 * One bar per block interval, newest on the right, against the 75-second target.
 *
 * One clock, ours: each bar is `received_at` here less `received_at` at the previous height —
 * when our follower stored each block — never a miner's header time, which measures somebody
 * else's clock discipline. This measures propagation as we saw it.
 *
 * A bar with no interval is a gap, not a zero: below the recording start no arrival was stored,
 * and a zero-height bar would state that a block arrived instantly. Slots fill the width, each
 * bar has a full-height hit area, and the hovered or focused reading is printed in the strip's
 * caption rather than behind a tooltip.
 */
export function Heartbeat({ blocks, liveSeconds, unavailable }: HeartbeatProps) {
  const [reading, setReading] = useState<string | null>(null);
  const drawn = blocks.slice(-MAX_BARS);
  // One slot per drawn block plus the growing live bar, never fewer than MIN_SLOTS.
  const slots = Math.max(MIN_SLOTS, drawn.length + 1);
  const slotWidth = W / slots;
  const barWidth = Math.max(1, slotWidth - 2);
  const first = slots - drawn.length - 1;
  const targetY = H - scale(TARGET_SECONDS);
  const caption = unavailable
    ? "unavailable"
    : (reading ?? `block intervals · ${TARGET_SECONDS} s target · hover a bar`);
  const clear = () => setReading(null);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="pulse-heart"
      role="img"
      aria-label={`Block intervals as our node received them, newest on the right, against a ${TARGET_SECONDS} second target.`}
      onPointerLeave={clear}
    >
      <line x1={0} y1={targetY} x2={W} y2={targetY} className="pulse-beat-target" />
      {/* Left, not right: the newest bar grows at the right edge and would run into it. */}
      <text x={2} y={8} className="pulse-beat-label" data-heartbeat-caption>
        {caption}
      </text>
      {drawn.map((block, i) => {
        const x = (first + i) * slotWidth + 1;
        const text = barReading(block);
        const gap = block.intervalSeconds === null;
        const height =
          block.intervalSeconds === null ? 5 : Math.max(1, scale(block.intervalSeconds));
        return (
          <g
            key={block.pools.hash}
            className="pulse-beat-slot"
            tabIndex={0}
            onPointerEnter={() => setReading(text)}
            onFocus={() => setReading(text)}
            onBlur={clear}
          >
            <title>{text}</title>
            {/* The hit area is the whole column, so a thin bar is not the target. */}
            <rect x={x - 1} y={10} width={slotWidth} height={H - 10} className="pulse-beat-hit" />
            <rect
              x={x}
              y={gap ? H - 6 : H - height}
              width={barWidth}
              height={height}
              className={gap ? "pulse-beat-gap" : "pulse-beat-bar"}
            />
          </g>
        );
      })}
      {liveSeconds === null ? null : (
        <g
          className="pulse-beat-slot"
          tabIndex={0}
          onPointerEnter={() =>
            setReading(`${Math.round(liveSeconds)} s since our node received the newest block`)
          }
          onFocus={() =>
            setReading(`${Math.round(liveSeconds)} s since our node received the newest block`)
          }
          onBlur={clear}
        >
          <title>{`${Math.round(liveSeconds)} s since our node received the newest block`}</title>
          <rect
            x={(slots - 1) * slotWidth}
            y={10}
            width={slotWidth}
            height={H - 10}
            className="pulse-beat-hit"
          />
          <rect
            x={(slots - 1) * slotWidth + 1}
            y={H - Math.max(1, scale(liveSeconds))}
            width={barWidth}
            height={Math.max(1, scale(liveSeconds))}
            className="pulse-beat-bar is-hot"
          />
        </g>
      )}
    </svg>
  );
}
