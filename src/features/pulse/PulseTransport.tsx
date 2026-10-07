"use client";

import { Badge } from "@/components/Badge";
import { PulseSegmented } from "./PulseSegmented";

export type PulseMode = "live" | "replay";

/** The three reaches. 24 h is the practical ceiling of the index. */
export const PULSE_RANGES = [3600, 21600, 86400] as const;
export type PulseRange = (typeof PULSE_RANGES)[number];

/** ×600 crosses an hour in six seconds, which is where per-movement marks stop being legible. */
export const PULSE_SPEEDS = [1, 10, 60, 600] as const;
export type PulseSpeed = (typeof PULSE_SPEEDS)[number];

const RANGE_LABEL: Readonly<Record<PulseRange, string>> = {
  3600: "1 h",
  21600: "6 h",
  86400: "24 h",
};

export interface PulseTransportProps {
  mode: PulseMode;
  range: PulseRange;
  speed: PulseSpeed;
  playing: boolean;
  /** How far back the clock is, in seconds. `range` is the far end. */
  secondsAgo: number;
  /** Hours whose read failed, as seconds-ago positions, so the scrubber can mark the holes. */
  failedMarks: readonly number[];
  /** A block on screen was stored long after it was mined, so its placement is header time. */
  indexedLate: boolean;
  onMode: (mode: PulseMode) => void;
  onRange: (range: PulseRange) => void;
  onSpeed: (speed: PulseSpeed) => void;
  onPlaying: (playing: boolean) => void;
  onScrub: (secondsAgo: number) => void;
}

const hms = (seconds: number): string =>
  `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(Math.floor(seconds) % 60).padStart(2, "0")}`;

function Segmented<T extends string | number>({
  label,
  options,
  value,
  format,
  onChange,
}: {
  label: string;
  options: readonly T[];
  value: T;
  format: (value: T) => string;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <p className="microlabel text-ink-faint">{label}</p>
      <PulseSegmented
        ariaLabel={label}
        options={options}
        value={value}
        format={format}
        onChange={onChange}
      />
    </div>
  );
}

/**
 * Where in the last twenty-four hours the stage is, and how fast it is moving.
 *
 * Buttons and a slider rather than links: a filter changes what the page claims and must be a
 * shareable URL, while a transport only changes which instant is drawn from data the page
 * already has. Nothing here is stored and nothing navigates.
 *
 * Absent from the static markup, mounted only once JavaScript runs: a play button on a page that
 * cannot animate is a dead control. A reader without scripting keeps the server's frame 0.
 */
export function PulseTransport({
  mode,
  range,
  speed,
  playing,
  secondsAgo,
  failedMarks,
  indexedLate,
  onMode,
  onRange,
  onSpeed,
  onPlaying,
  onScrub,
}: PulseTransportProps) {
  return (
    <div className="pulse-controls" aria-label="time">
      <Segmented
        label="time"
        options={["live", "replay"] as const}
        value={mode}
        format={(v) => (v === "live" ? "● live" : "◂ replay")}
        onChange={onMode}
      />
      {indexedLate ? (
        <Badge
          tone="outline"
          title="Our follower stored this block long after it was mined, so its arrival time measures our backfill rather than propagation. It is placed at the miner's header time instead."
        >
          clock: header time · indexed late
        </Badge>
      ) : null}
      {mode === "replay" ? (
        <>
          <Segmented
            label="back"
            options={PULSE_RANGES}
            value={range}
            format={(v) => RANGE_LABEL[v]}
            onChange={onRange}
          />
          <div className="flex flex-1 basis-[320px] items-center gap-3">
            <input
              type="range"
              min={0}
              max={range}
              step={1}
              // Newest on the right, which is the direction the heartbeat and the log both
              // read: the slider carries seconds-ago, so it is inverted at the boundary.
              value={range - secondsAgo}
              aria-label="how far back, in seconds"
              className="pulse-scrub"
              onChange={(e) => onScrub(range - Number(e.target.value))}
            />
            <span className="min-w-[9ch] text-ink tabular-nums">{hms(secondsAgo)} ago</span>
          </div>
          {failedMarks.length > 0 ? (
            // Our own outage, never the Veil: redaction means encrypted on-chain, and spending it
            // on a failed read of ours would teach a reader that our downtime is a privacy
            // property. The warning role, in the site's one pill.
            <span data-pulse-gap className="inline-flex">
              <Badge
                tone="warn"
                title={`${failedMarks.length} hour${failedMarks.length === 1 ? "" : "s"} of the replay could not be read. A quiet stretch there is our gap, not the chain's.`}
              >
                {failedMarks.length} hour{failedMarks.length === 1 ? "" : "s"} unavailable
              </Badge>
            </span>
          ) : null}
          <Segmented
            label="speed"
            options={PULSE_SPEEDS}
            value={speed}
            format={(v) => `×${v}`}
            onChange={onSpeed}
          />
          <button
            type="button"
            aria-pressed={playing}
            className="pulse-play"
            onClick={() => onPlaying(!playing)}
          >
            {playing ? "pause" : "play"}
          </button>
        </>
      ) : null}
    </div>
  );
}
