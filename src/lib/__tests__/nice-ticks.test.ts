import { describe, expect, it } from "vitest";
import { compactCountTick, formatShareTick, formatUsdTick, formatZecTick } from "../format";
import { niceAxis } from "../nice-ticks";

/** Whether a value is 1, 2, 2.5 or 5 times a power of ten. */
const isRoundStep = (step: number) => {
  const exp = Math.floor(Math.log10(step));
  const mantissa = Number((step / 10 ** exp).toPrecision(6));
  return [1, 2, 2.5, 5].includes(mantissa);
};

describe("niceAxis", () => {
  it("replaces fractions of the maximum with round steps", () => {
    // The old axis printed 0 / 867.3K / 1.73M / 2.60M / 3.47M for this maximum.
    expect(niceAxis(0, 3_469_000).ticks).toEqual([0, 1e6, 2e6, 3e6, 4e6]);
  });

  it("extends the axis to the next round value and runs the scale to it", () => {
    const axis = niceAxis(0, 1.05);
    expect(axis.ticks).toEqual([0, 0.25, 0.5, 0.75, 1, 1.25]);
    expect(axis.max).toBe(1.25);
    expect(axis.min).toBe(0);
  });

  it("lands decimal steps on clean values, not 0.30000000000000004", () => {
    expect(niceAxis(0, 0.9).ticks).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(niceAxis(0, 0.00037).ticks).toEqual([0, 0.0001, 0.0002, 0.0003, 0.0004]);
  });

  it("always gives four to six ticks on a round step that covers the data", () => {
    for (let k = 0; k < 2_000; k += 1) {
      // Maxima spread over twelve decades, deterministic.
      const hi = 10 ** ((k % 120) / 10 - 4) * (1 + ((k * 7919) % 1000) / 1000);
      const { ticks, step, max, min } = niceAxis(0, hi);
      expect(ticks.length).toBeGreaterThanOrEqual(4);
      expect(ticks.length).toBeLessThanOrEqual(6);
      expect(isRoundStep(step)).toBe(true);
      expect(min).toBe(0);
      expect(max).toBeGreaterThanOrEqual(hi);
      // Never more than one step of empty headroom.
      expect(max - hi).toBeLessThan(step);
    }
  });

  it("keeps zero as the baseline when the data starts near it", () => {
    expect(niceAxis(12, 100).min).toBe(0);
  });

  it("keeps a clipped floor when the data sits far from zero", () => {
    const axis = niceAxis(747, 888);
    expect(axis.min).toBe(700);
    expect(axis.max).toBe(900);
    expect(axis.ticks.every((t) => t % 50 === 0)).toBe(true);
  });

  it("states a flat series on a zero-based axis, and an empty one on 0..1", () => {
    expect(niceAxis(5, 5).ticks).toEqual([0, 1, 2, 3, 4, 5]);
    expect(niceAxis(0, 0).ticks).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
  });

  it("mirrors about zero for two directions on one scale", () => {
    expect(niceAxis(-3.47, 3.47, { symmetric: true }).ticks).toEqual([-4, -2, 0, 2, 4]);
    // Either side's reach decides; the other direction mirrors it.
    expect(niceAxis(-0.4, 2.6, { symmetric: true }).ticks).toEqual([-3, -2, -1, 0, 1, 2, 3]);
    for (let k = 1; k < 500; k += 1) {
      const reach = k * 13.7;
      const { ticks, max, min } = niceAxis(-reach, reach, { symmetric: true });
      expect(ticks.includes(0)).toBe(true);
      expect(min).toBe(-max);
      expect(max).toBeGreaterThanOrEqual(reach);
      expect([3, 5, 7]).toContain(ticks.length);
    }
  });

  it("never emits a negative zero", () => {
    const { ticks } = niceAxis(-1, 1, { symmetric: true });
    expect(ticks.some((t) => Object.is(t, -0))).toBe(false);
  });

  it("passes over a step whose labels would repeat or blank, for the next coarser one", () => {
    // A count of 0..3: steps of 0.5 would print "1.5" transactions; whole steps instead.
    expect(niceAxis(0, 3, { label: compactCountTick }).ticks).toEqual([0, 1, 2, 3]);
    // A formatter that rounds to whole units would print "1" twice at a 0.5 step.
    const whole = (v: number) => String(Math.round(v));
    expect(niceAxis(0, 2.2, { label: whole }).ticks).toEqual([0, 1, 2, 3]);
  });

  it("reads cleanly through the site's tick formatters", () => {
    const zat = 100_000_000;
    expect(niceAxis(0, 3_469_000 * zat, { label: formatZecTick }).ticks.map(formatZecTick)).toEqual(
      ["0 ZEC", "1M ZEC", "2M ZEC", "3M ZEC", "4M ZEC"],
    );
    expect(niceAxis(0, 11_200, { label: compactCountTick }).ticks.map(compactCountTick)).toEqual([
      "0",
      "2.5K",
      "5K",
      "7.5K",
      "10K",
      "12.5K",
    ]);
  });
});

describe("tick formatters", () => {
  it("drop trailing zeros a round tick does not need", () => {
    expect(formatZecTick(250_000_000_000_000)).toBe("2.5M ZEC");
    expect(formatZecTick(1_500_000_000_000)).toBe("15K ZEC");
    expect(formatZecTick(1_250_000)).toBe("0.0125 ZEC");
  });

  it("print a count tick exactly, and a fractional one not at all", () => {
    expect(compactCountTick(2_500)).toBe("2.5K");
    expect(compactCountTick(1_250_000)).toBe("1.25M");
    expect(compactCountTick(740)).toBe("740");
    expect(compactCountTick(0.5)).toBe("");
  });

  it("print a price step exactly, where the readout form drops cents from $100", () => {
    // A week from $141 to $152 steps by $2.50; "$143" for $142.50 would misplace the line.
    const labels = niceAxis(140, 152, { label: formatUsdTick }).ticks.map(formatUsdTick);
    expect(labels).toEqual(["$140", "$142.50", "$145", "$147.50", "$150", "$152.50"]);
  });

  it("print a share step with the digits it needs", () => {
    expect(niceAxis(0, 100).ticks.map(formatShareTick)).toEqual([
      "0%",
      "20%",
      "40%",
      "60%",
      "80%",
      "100%",
    ]);
    expect(formatShareTick(0.25)).toBe("0.25%");
  });
});
