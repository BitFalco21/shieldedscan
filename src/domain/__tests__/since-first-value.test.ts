import { describe, expect, it } from "vitest";
import { sinceFirstValue } from "../series";

/**
 * The distinction under test is "did not exist yet" versus "existed and held nothing": the
 * second is a real measurement, so only the leading run of zeros may be blanked.
 */
describe("sinceFirstValue", () => {
  it("blanks the zeros before a pool first held value", () => {
    expect(sinceFirstValue([0, 0, 5, 7])).toEqual([null, null, 5, 7]);
  });

  it("KEEPS a zero after the first value — a pool draining to nothing is the story", () => {
    // Sprout is the real case: it held value, then drained. Those zeros are measurements.
    expect(sinceFirstValue([3, 1, 0, 0])).toEqual([3, 1, 0, 0]);
  });

  it("keeps a zero in the middle of a pool's life", () => {
    expect(sinceFirstValue([0, 4, 0, 9])).toEqual([null, 4, 0, 9]);
  });

  it("is a no-op for a pool that held value from the first point", () => {
    expect(sinceFirstValue([2, 3, 4])).toEqual([2, 3, 4]);
  });

  it("blanks everything for a pool that never held value", () => {
    // A window entirely before activation — every point is absence, not a row of zeros.
    expect(sinceFirstValue([0, 0, 0])).toEqual([null, null, null]);
  });

  it("treats a negative first value as the start of life, not as absence", () => {
    // Defensive: a balance should never be negative, but `!== 0` must not be mistaken for
    // `> 0`, or a bad reading would silently vanish from the readout instead of showing.
    expect(sinceFirstValue([0, -1, 5])).toEqual([null, -1, 5]);
  });

  it("returns an empty array for an empty series rather than throwing", () => {
    expect(sinceFirstValue([])).toEqual([]);
  });
});
