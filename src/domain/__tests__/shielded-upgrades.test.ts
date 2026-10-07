import { describe, expect, it } from "vitest";
import type { ChainMonthPoint } from "../analytics";
import { upgradeMarkers } from "../shielded-upgrades";

const point = (topHeight: number): ChainMonthPoint => ({
  timestamp: topHeight,
  topHeight,
  transparentTxs: 0,
  mixedTxs: 0,
  shieldedTxs: 0,
  sproutZat: 0,
  saplingZat: 0,
  orchardZat: 0,
  ironwoodZat: 0,
});

const upgrades = [
  { height: 100, label: "A" },
  { height: 250, label: "B" },
  { height: 900, label: "C" },
];

describe("upgradeMarkers", () => {
  it("places each upgrade at the first point whose closing height reaches it", () => {
    const series = [point(150), point(200), point(300), point(400)];
    expect(upgradeMarkers(series, upgrades)).toEqual([{ index: 2, label: "B" }]);
  });

  it("drops an upgrade at or before the series start, and one past its end", () => {
    const series = [point(100), point(300)];
    expect(upgradeMarkers(series, upgrades)).toEqual([{ index: 1, label: "B" }]);
  });
});
