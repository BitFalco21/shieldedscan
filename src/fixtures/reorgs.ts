import type { ReorgEvent, ReorgSummary } from "@/domain";
import { TIP_HEIGHT, TIP_TIME, hex64 } from "./ids";

const DAY = 86_400;

/**
 * Reorgs the fixture node "observed". Mostly depth 1 — the routine case the page must
 * teach is not an alarm — plus one depth-2, so the DEEPEST stat and a multi-block row
 * have a designed state.
 *
 * `replacedBy` is the fixture chain's real hash at that height (`hex64("b<height>")`), so
 * the link resolves to a live block page. `orphanedHash` deliberately matches nothing in
 * the fixture chain: that block is gone, which is why the page must never link it.
 */
export const reorgEvents: ReorgEvent[] = [
  {
    id: 3,
    detectedAt: TIP_TIME - 2 * DAY,
    height: TIP_HEIGHT - 12,
    depth: 1,
    orphanedHash: hex64("0defa11e11"),
    replacedBy: hex64(`b${TIP_HEIGHT - 12}`),
  },
  {
    id: 2,
    detectedAt: TIP_TIME - 6 * DAY,
    height: TIP_HEIGHT - 29,
    depth: 2,
    orphanedHash: hex64("0defa22e07"),
    replacedBy: hex64(`b${TIP_HEIGHT - 29}`),
  },
  {
    id: 1,
    detectedAt: TIP_TIME - 11 * DAY,
    height: TIP_HEIGHT - 33,
    depth: 1,
    orphanedHash: hex64("0defa33e03"),
    replacedBy: hex64(`b${TIP_HEIGHT - 33}`),
  },
];

export const reorgSummary: ReorgSummary = {
  observedCount: reorgEvents.length,
  deepestDepth: Math.max(...reorgEvents.map((event) => event.depth)),
  observingSince: TIP_TIME - 14 * DAY,
};
