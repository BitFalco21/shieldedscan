import {
  ARRIVAL_ALL_GROUP,
  ARRIVAL_LATE_SECONDS,
  ARRIVAL_MIN_BLOCKS,
  BLOCK_ARRIVAL_WINDOWS,
  BLOCK_ARRIVAL_WINDOW_DAYS,
  UNATTRIBUTED_GROUP,
  arrivalCell,
  sortArrivalCells,
  type BlockArrivalSeries,
} from "@/domain";
import { DAY_SECONDS, utcDayFromSeconds } from "@/domain/time";
import { TIP_TIME } from "./ids";

/**
 * Seventy days of block ages on arrival, built from per-block ages through the domain's own
 * `arrivalCell`, so the fixture states what the SQL would. It carries every case the chart and
 * the API must draw: negative ages (KuPool's clock runs ahead), late blocks dropped from the
 * percentiles, a pool with too few blocks a day for any (NiceHash), unattributed blocks, a day
 * our follower was down (every block late), and today still running.
 */
const RECORDED_DAYS = 70;

/** Blocks per day, a typical median lag and its spread, by group. */
const GROUPS: ReadonlyArray<{ group: string; blocks: number; lag: number; spread: number }> = [
  { group: "viabtc", blocks: 330, lag: 14, spread: 14 },
  { group: "foundry", blocks: 260, lag: 9, spread: 10 },
  { group: "f2pool", blocks: 150, lag: 31, spread: 22 },
  { group: "luxor", blocks: 120, lag: 12, spread: 8 },
  { group: "2miners", blocks: 80, lag: 20, spread: 25 },
  { group: "antpool", blocks: 60, lag: 24, spread: 16 },
  { group: "kupool", blocks: 40, lag: -2, spread: 6 },
  { group: "nicehash", blocks: 3, lag: 15, spread: 10 },
  { group: UNATTRIBUTED_GROUP, blocks: 110, lag: 18, spread: 20 },
];

/** mulberry32: deterministic, so every run and every render draws the same fixture. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

let memo: BlockArrivalSeries | null = null;

export function getBlockArrival(): BlockArrivalSeries {
  return (memo ??= build());
}

function build(): BlockArrivalSeries {
  const today = Math.floor(TIP_TIME / DAY_SECONDS) * DAY_SECONDS;
  const first = today - (RECORDED_DAYS - 1) * DAY_SECONDS;
  // A follower restart: every block that day was stored past the threshold.
  const outage = today - 23 * DAY_SECONDS;
  const rand = random(7);
  const ages = new Map<number, Map<string, number[]>>();
  for (let d = first; d <= today; d += DAY_SECONDS) {
    const byGroup = new Map<string, number[]>();
    const share = d === today ? (TIP_TIME - today) / DAY_SECONDS : 1;
    for (const g of GROUPS) {
      const n = Math.round(g.blocks * share);
      const list: number[] = [];
      for (let i = 0; i < n; i += 1) {
        // A long right tail: most blocks arrive near the lag, a few much later.
        const tail = -Math.log(1 - rand()) * g.spread;
        let age = Math.round(g.lag - g.spread / 2 + tail);
        if (d === outage || rand() < 0.003)
          age = ARRIVAL_LATE_SECONDS + 60 + Math.round(rand() * 900);
        list.push(age);
      }
      byGroup.set(g.group, list);
    }
    ages.set(d, byGroup);
  }

  const cellsOver = (from: number, to: number) => {
    const merged = new Map<string, number[]>();
    for (const [d, byGroup] of ages) {
      if (d < from || d > to) continue;
      for (const [g, list] of byGroup) merged.set(g, [...(merged.get(g) ?? []), ...list]);
    }
    const all = [...merged.values()].flat();
    return sortArrivalCells([
      arrivalCell(ARRIVAL_ALL_GROUP, all),
      ...[...merged.entries()].map(([g, list]) => arrivalCell(g, list)),
    ]);
  };

  return {
    recordingSince: utcDayFromSeconds(first),
    lateSeconds: ARRIVAL_LATE_SECONDS,
    minBlocks: ARRIVAL_MIN_BLOCKS,
    days: [...ages.keys()].map((d) => ({
      day: utcDayFromSeconds(d),
      partial: d === today,
      groups: cellsOver(d, d),
    })),
    windows: BLOCK_ARRIVAL_WINDOWS.map((w) => {
      const from = today - (BLOCK_ARRIVAL_WINDOW_DAYS[w] - 1) * DAY_SECONDS;
      return {
        window: w,
        fromDay: utcDayFromSeconds(from),
        toDay: utcDayFromSeconds(today),
        groups: cellsOver(from, today),
      };
    }),
    asOf: TIP_TIME,
  };
}
