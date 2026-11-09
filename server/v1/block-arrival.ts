import {
  BLOCK_ARRIVAL_WINDOWS,
  BLOCK_ARRIVAL_WINDOW_DAYS,
  arrivalGroupName,
  arrivalUnstamped,
  type BlockArrivalCell,
  type BlockArrivalSeries,
  type BlockArrivalWindowKey,
} from "@/domain";
import { DAY_SECONDS, utcDayFromSeconds } from "@/domain/time";
import type { V1BlockArrival, V1BlockArrivalCell, V1Unknowns } from "./dto";
import { ParamError } from "./params";

/**
 * Block age on arrival on the public API: the `block_arrival_*` tables the primary's tracker keeps
 * (`server/block-arrival.ts`), read through the `/miners` reader's ten-minute memo.
 */

export const V1_BLOCK_ARRIVAL_PATH = "/v1/analytics/mining-pools/arrival";

/** `window`: 7d, 30d or 90d, 30d by default; anything else is a 400. */
export function parseArrivalWindow(raw: string | undefined): BlockArrivalWindowKey {
  if (raw === undefined || raw === "") return "30d";
  const found = BLOCK_ARRIVAL_WINDOWS.find((w) => w === raw);
  if (found) return found;
  throw new ParamError(
    "invalid_parameter",
    `window must be one of ${BLOCK_ARRIVAL_WINDOWS.join(", ")}`,
  );
}

const BASIS =
  "A block's age on arrival is the time from its own header timestamp to the moment this explorer's follower first stored it. It adds up the miner's timestamp lag (a miner stamps a template and keeps mining on it without moving the time forward), the network's propagation to our node, and our own poll and store latency (about 5 to 10 seconds), less any error between the two clocks. Mostly the first differs by pool, though propagation can too, and the figure cannot separate them. A negative age is a miner's clock ahead of ours and is kept as measured. A block stored more than `lateSeconds` after its header time, almost always our own outage (a node swap, a restart), is left out of the percentiles, counted in `late`. Percentiles are nearest-rank whole seconds over a group's measured blocks, null below `minBlocks`; they do not add or average across days. A pool is this explorer's reviewed label on payout addresses; every other block is `unattributed`. Days are UTC by header timestamp.";

function cell(c: BlockArrivalCell, path: string, unknowns: V1Unknowns): V1BlockArrivalCell {
  if (c.p50Seconds === null) unknowns[`${path}.p50Seconds`] = "unmeasured";
  if (c.p90Seconds === null) unknowns[`${path}.p90Seconds`] = "unmeasured";
  return {
    group: c.group,
    name: arrivalGroupName(c.group),
    blocks: c.blocks,
    measured: c.measured,
    late: c.late,
    unstamped: arrivalUnstamped(c),
    p50Seconds: c.p50Seconds,
    p90Seconds: c.p90Seconds,
  };
}

export function toBlockArrival(
  s: BlockArrivalSeries,
  window: BlockArrivalWindowKey,
  siteUrl: string,
  asOf: number,
): V1BlockArrival {
  const unknowns: V1Unknowns = {};
  const notes: string[] = [];
  // One clock for every day this answer names: the window's start, which day is today, and so
  // which day is still running. The memo the series came from may be minutes older.
  const today = utcDayFromSeconds(asOf);
  const fromDay = utcDayFromSeconds(
    Math.floor(asOf / DAY_SECONDS) * DAY_SECONDS -
      (BLOCK_ARRIVAL_WINDOW_DAYS[window] - 1) * DAY_SECONDS,
  );
  const w = s.windows.find((x) => x.window === window) ?? null;
  if (w === null) {
    unknowns["data.window"] = "unmeasured";
    notes.push("The window has not been computed yet; retry in a few minutes.");
  } else if (w.toDay < today) {
    notes.push(
      `The window was last computed at ${new Date(w.computedAt * 1000).toISOString()} and ends ${w.toDay}, not today: its figures are stale.`,
    );
  }
  if (s.recordingSince === null) notes.push("No block carries an arrival stamp yet.");
  else if (s.recordingSince > fromDay) {
    notes.push(`Recording began on ${s.recordingSince}; the window holds nothing earlier.`);
  }
  const days = s.days
    .filter((d) => d.day >= fromDay)
    .map((d) => ({ ...d, partial: d.day >= today }));
  if (days.some((d) => d.partial)) notes.push("The newest day holds today and is still running.");
  return {
    query: { window },
    // The weakest property names the status: any note is a reason the answer is not whole.
    coverage: { status: notes.length > 0 ? "partial" : "complete", notes },
    source: { name: "ShieldedScan", url: `${siteUrl}/charts/block-arrival-age` },
    basis: BASIS,
    data: {
      recordingSince: s.recordingSince,
      lateSeconds: s.lateSeconds,
      minBlocks: s.minBlocks,
      window:
        w === null
          ? null
          : {
              key: window,
              fromDay: w.fromDay,
              toDay: w.toDay,
              computedAt: w.computedAt,
              groups: w.groups.map((g, i) => cell(g, `data.window.groups.${i}`, unknowns)),
            },
      days: days.map((d, i) => ({
        day: d.day,
        partial: d.partial,
        groups: d.groups.map((g, j) => cell(g, `data.days.${i}.groups.${j}`, unknowns)),
      })),
    },
    ...(Object.keys(unknowns).length > 0 ? { unknowns } : {}),
    asOf,
  };
}
