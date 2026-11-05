import { NU7_HEIGHT, targetSpacingAt, type BlockSummary } from "@/domain";
import { activationEtaSeconds, blocksToGo, formatRemainingCoarse } from "./nu7-countdown";

/**
 * How long the site bar keeps saying "NU7 is live" after the activation block, on the chain's
 * own clock. The one cut-off: past it the bar renders nothing, and it can then be deleted
 * together with its line in the root layout.
 */
export const NU7_BAR_LIVE_SECONDS = 24 * 3_600;

export interface Nu7BarTip {
  height: number;
  lastBlockTimestamp: number;
}

/** What the bar says. `static` is the server's text, kept until a read succeeds. */
export type Nu7BarText =
  | { kind: "static" }
  | { kind: "counting"; blocks: number; remaining: string | null }
  | { kind: "live" }
  | { kind: "over" };

/**
 * The activation block's time: its own timestamp when the payload carries it, otherwise counted
 * back from the tip at the post-NU7 target. Only ever compared against the cut-off, never shown.
 */
function activationTime(tip: Nu7BarTip, blocks: readonly BlockSummary[]): number {
  const block = blocks.find((b) => b.height === NU7_HEIGHT);
  if (block) return block.timestamp;
  return tip.lastBlockTimestamp - (tip.height - NU7_HEIGHT) * targetSpacingAt(NU7_HEIGHT);
}

export function nu7BarText(
  tip: Nu7BarTip | null,
  blocks: readonly BlockSummary[],
  readAtSeconds: number,
): Nu7BarText {
  if (tip === null) return { kind: "static" };
  if (tip.height < NU7_HEIGHT) {
    const eta = activationEtaSeconds(tip.height, tip.lastBlockTimestamp);
    return {
      kind: "counting",
      blocks: blocksToGo(tip.height),
      remaining: formatRemainingCoarse(eta - readAtSeconds),
    };
  }
  const since = tip.lastBlockTimestamp - activationTime(tip, blocks);
  return since >= NU7_BAR_LIVE_SECONDS ? { kind: "over" } : { kind: "live" };
}
