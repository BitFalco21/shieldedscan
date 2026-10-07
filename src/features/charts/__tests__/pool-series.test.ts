import { describe, expect, it } from "vitest";
import { POOL_CLASSES } from "@/lib/pool-palette";
import { POOL_STACK, poolBands, poolLines } from "../pool-series";

const values = {
  sprout: [5, 5],
  sapling: [0, 3],
  orchard: [0, 0],
  ironwood: [1, 2],
};

describe("poolBands", () => {
  it("draws every pool in stacking order, in its site-wide colour", () => {
    const bands = poolBands(values);
    expect(bands.map((b) => b.key)).toEqual([...POOL_STACK]);
    expect(bands.map((b) => b.label)).toEqual(["Sprout", "Sapling", "Orchard", "Ironwood"]);
    for (const band of bands) expect(band.colorClass).toBe(POOL_CLASSES[band.key as never]);
  });

  it("keeps a pool out of the readout until it first holds value", () => {
    const bands = poolBands(values);
    expect(bands.find((b) => b.key === "sapling")!.values).toEqual([null, 3]);
    expect(bands.find((b) => b.key === "orchard")!.values).toEqual([null, null]);
  });
});

describe("poolLines", () => {
  it("names each line after its pool and omits pre-activation nulls from the readout", () => {
    const lines = poolLines(values);
    expect(lines.map((l) => l.name)).toEqual(["Sprout", "Sapling", "Orchard", "Ironwood"]);
    expect(lines.every((l) => l.omitNullFromReadout)).toBe(true);
    expect(lines[1]!.values).toEqual([null, 3]);
  });
});
