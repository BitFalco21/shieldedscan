import type { ChainMonthPoint } from "./analytics";

/**
 * Network upgrade activation heights, read from the live node's `getblockchaininfo`.
 *
 * These are consensus facts — a height at which the rules changed — which is what makes them
 * the one annotation these charts may assert. The shapes are unreadable without them: the
 * fully-shielded share tripling in 2022 means nothing until you know Orchard shipped at
 * 1,687,104, and Ironwood's pool appearing from nowhere means nothing without 3,428,143.
 *
 * Only the upgrades that changed what a *shielded* transaction can be are listed. Blossom
 * (block timing) and Heartwood (shielded coinbase) did not move these series, and a chart
 * with ten vertical rules annotates nothing.
 */
export interface ShieldedUpgrade {
  height: number;
  label: string;
}

export const SHIELDED_UPGRADES: ShieldedUpgrade[] = [
  { height: 419_200, label: "Sapling" },
  { height: 1_046_400, label: "Canopy" },
  { height: 1_687_104, label: "NU5 · Orchard" },
  { height: 3_428_143, label: "NU6.3 · Ironwood" },
];

/**
 * Places each upgrade on the monthly axis: the first month whose closing height has reached
 * it.
 *
 * Returns only upgrades the series actually covers — a marker at index 0 for an upgrade that
 * predates the data would claim the series starts there, and one past the end would be drawn
 * off the chart.
 */
export function upgradeMarkers(
  series: readonly ChainMonthPoint[],
  upgrades: readonly ShieldedUpgrade[] = SHIELDED_UPGRADES,
): { index: number; label: string }[] {
  return upgrades.flatMap((u) => {
    const index = series.findIndex((p) => p.topHeight >= u.height);
    // Not found, or found at the very first point (so the activation is at or before the
    // series start and the rule would sit on the axis).
    return index <= 0 ? [] : [{ index, label: u.label }];
  });
}
