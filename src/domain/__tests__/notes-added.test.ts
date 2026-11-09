import { describe, expect, it } from "vitest";
import { notesAdded, type NoteTreeDayPoint } from "@/domain";

const DAY = 86_400;
const start = Date.UTC(2026, 0, 30) / 1000;
const day = (
  i: number,
  sapling: number | null,
  orchard: number | null,
  ironwood: number | null,
): NoteTreeDayPoint => ({
  timestamp: start + i * DAY,
  saplingNotes: sapling,
  orchardNotes: orchard,
  ironwoodNotes: ironwood,
});

describe("notesAdded", () => {
  const points = [
    day(0, 100, 50, null),
    day(1, 110, 70, null),
    day(2, 130, 75, 4), // Ironwood's first close: growth from empty
    day(3, 131, 80, 10),
  ];

  it("is the difference of two closes, per pool, never summed across pools", () => {
    expect(notesAdded(points, "day")).toEqual([
      { timestamp: start, sapling: null, orchard: null, ironwood: null },
      { timestamp: start + DAY, sapling: 10, orchard: 20, ironwood: null },
      { timestamp: start + 2 * DAY, sapling: 20, orchard: 5, ironwood: 4 },
      { timestamp: start + 3 * DAY, sapling: 1, orchard: 5, ironwood: 6 },
    ]);
  });

  it("has no base for a series that opens on a pool already holding notes", () => {
    expect(notesAdded([day(0, 100, 50, null)], "day")[0]!.sapling).toBeNull();
  });

  it("never reads the whole tree as growth after a missing close mid-series", () => {
    const holed = [day(0, 100, 50, null), day(1, null, 60, null), day(2, 50_000_120, 70, null)];
    const days = notesAdded(holed, "day");
    expect(days.map((d) => d.sapling)).toEqual([null, null, null]);
    expect(days[2]!.orchard).toBe(10);
    // And its month says unknown, never a month that grew by the tree.
    expect(notesAdded(holed, "month").map((m) => m.sapling)).toEqual([null, null]);
  });

  it("refuses a difference across a missing day", () => {
    const gap = [day(0, 100, 50, null), day(2, 120, 60, null)];
    expect(notesAdded(gap, "day")[1]).toMatchObject({ sapling: null, orchard: null });
  });

  it("sums days into months, and leaves a month with an unknown day unknown", () => {
    // Jan 30, 31 | Feb 1, 2. January opens the series, so its first day has no base.
    const months = notesAdded(points, "month");
    expect(months).toEqual([
      { timestamp: Date.UTC(2026, 0, 1) / 1000, sapling: null, orchard: null, ironwood: null },
      { timestamp: Date.UTC(2026, 1, 1) / 1000, sapling: 21, orchard: 10, ironwood: 10 },
    ]);
  });

  it("keeps a month before a pool existed null, never zero", () => {
    const early = [day(0, 100, null, null), day(1, 110, null, null), day(2, 111, null, null)];
    const feb = notesAdded(early, "month")[1]!;
    expect(feb.sapling).toBe(1);
    expect(feb.orchard).toBeNull();
  });
});
