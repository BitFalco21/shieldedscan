import { describe, expect, it } from "vitest";
import {
  ARRIVAL_ALL_GROUP,
  ARRIVAL_MIN_BLOCKS,
  UNATTRIBUTED_GROUP,
  arrivalCell,
  arrivalGroupName,
  arrivalUnstamped,
  nearestRank,
  sortArrivalCells,
} from "@/domain";

describe("nearestRank", () => {
  it("returns a value the data holds, as percentile_disc does", () => {
    expect(nearestRank([1, 2, 3, 4], 0.5)).toBe(2);
    expect(nearestRank([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(nearestRank([10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 0.9)).toBe(90);
    expect(nearestRank([7], 0.9)).toBe(7);
    expect(nearestRank([], 0.5)).toBeNull();
  });
});

describe("arrivalCell", () => {
  it("leaves late and unstamped blocks out of the percentiles, and counts them", () => {
    const ages = [...Array.from({ length: 10 }, (_, i) => i * 2), 601, null, null];
    const cell = arrivalCell("foundry", ages);
    expect(cell).toEqual({
      group: "foundry",
      blocks: 13,
      measured: 10,
      late: 1,
      p50Seconds: 8,
      p90Seconds: 16,
    });
    expect(arrivalUnstamped(cell)).toBe(2);
  });

  it("keeps a negative age: a miner's clock ahead of ours is measured, never clamped", () => {
    const cell = arrivalCell("viabtc", [-9, -8, -7, -6, -5, -4, -3, -2, -1, 0]);
    expect(cell.p50Seconds).toBe(-5);
  });

  it("withholds percentiles below the minimum", () => {
    const cell = arrivalCell(
      "kupool",
      Array.from({ length: ARRIVAL_MIN_BLOCKS - 1 }, () => 5),
    );
    expect(cell).toMatchObject({ measured: ARRIVAL_MIN_BLOCKS - 1, p50Seconds: null });
  });
});

describe("ordering and names", () => {
  it("puts every block first and the unattributed last", () => {
    const cells = [
      arrivalCell(UNATTRIBUTED_GROUP, [1, 2]),
      arrivalCell("viabtc", [1]),
      arrivalCell("foundry", [1, 2, 3]),
      arrivalCell(ARRIVAL_ALL_GROUP, [1, 2, 3, 4, 5, 6]),
    ];
    expect(sortArrivalCells(cells).map((c) => c.group)).toEqual([
      ARRIVAL_ALL_GROUP,
      "foundry",
      "viabtc",
      UNATTRIBUTED_GROUP,
    ]);
    expect(arrivalGroupName("foundry")).toBe("Foundry USA");
    expect(arrivalGroupName(ARRIVAL_ALL_GROUP)).toBe("All blocks");
  });
});
