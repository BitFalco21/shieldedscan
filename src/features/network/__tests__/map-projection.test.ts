import { describe, expect, it } from "vitest";
import {
  LAND_DOTS_COUNT,
  LAND_DOTS_D,
  LAND_DOT_STEP,
  PROJECTION_PINS,
} from "../land-dots.generated";
import { MAP_HEIGHT, MAP_WIDTH, projectLonLat } from "../map-projection";
import { WORLD_MAP_HEIGHT, WORLD_MAP_WIDTH } from "@/features/mining-cost/world-map.generated";

/**
 * Two copies of one projection — Python at build time for the land, TypeScript at render time
 * for the nodes — held together by the points the script committed. A drift here puts a node
 * in the sea beside the coast it is on, which nothing on screen would flag.
 */
describe("the node map projection", () => {
  it("reproduces every pin the generator projected, to a tenth of a unit", () => {
    expect(PROJECTION_PINS.length).toBeGreaterThanOrEqual(3);
    for (const [lon, lat, x, y] of PROJECTION_PINS) {
      const [px, py] = projectLonLat(lon, lat);
      expect(Math.abs(px - x)).toBeLessThanOrEqual(0.1);
      expect(Math.abs(py - y)).toBeLessThanOrEqual(0.1);
    }
  });

  it("shares its viewBox with the tariff map, so the two maps draw the same Earth", () => {
    expect(MAP_WIDTH).toBe(WORLD_MAP_WIDTH);
    expect(MAP_HEIGHT).toBe(WORLD_MAP_HEIGHT);
  });

  it("keeps west left, north up, and the origin near the centre", () => {
    const [ox, oy] = projectLonLat(0, 0);
    expect(ox).toBeCloseTo(MAP_WIDTH / 2, 0);
    expect(oy).toBeCloseTo(MAP_HEIGHT / 2 + 10, 0);
    const [nyx, nyy] = projectLonLat(-74, 40.7);
    const [syx, syy] = projectLonLat(151.2, -33.9);
    expect(nyx).toBeLessThan(ox);
    expect(syx).toBeGreaterThan(ox);
    expect(nyy).toBeLessThan(oy);
    expect(syy).toBeGreaterThan(oy);
  });
});

describe("the land dots", () => {
  it("are one path of zero-length subpaths, one per counted dot", () => {
    expect(LAND_DOTS_D.startsWith("M")).toBe(true);
    expect(LAND_DOTS_D.match(/h0/g)?.length).toBe(LAND_DOTS_COUNT);
    // Land without Antarctica is roughly a quarter of the frame at this step.
    expect(LAND_DOTS_COUNT).toBeGreaterThan(6_000);
    expect(LAND_DOTS_COUNT).toBeLessThan(14_000);
    expect(LAND_DOT_STEP).toBe(3.4);
  });

  it("puts dots on land and none in the open ocean", () => {
    // Reconstruct absolute positions from the path and look for a dot near three inland
    // points and none near three mid-ocean ones — a misread parity flips exactly this.
    const dots: Array<[number, number]> = [];
    let x = 0;
    let y = 0;
    for (const m of LAND_DOTS_D.matchAll(/([Mm])(-?[\d.]+) (-?[\d.]+)h0/g)) {
      if (m[1] === "M") {
        x = Number(m[2]);
        y = Number(m[3]);
      } else {
        x += Number(m[2]);
      }
      dots.push([Math.round(x * 10) / 10, y]);
    }
    expect(dots).toHaveLength(LAND_DOTS_COUNT);
    const near = (lon: number, lat: number) => {
      const [px, py] = projectLonLat(lon, lat);
      return dots.some(([dx, dy]) => Math.abs(dx - px) <= 2.5 && Math.abs(dy - py) <= 2.5);
    };
    expect(near(-100, 40)).toBe(true); // Kansas
    expect(near(20, 50)).toBe(true); // Poland
    expect(near(80, 60)).toBe(true); // Siberia
    expect(near(-30, 30)).toBe(false); // mid-Atlantic
    expect(near(-150, 0)).toBe(false); // mid-Pacific
    expect(near(80, -40)).toBe(false); // southern Indian Ocean
  });
});
