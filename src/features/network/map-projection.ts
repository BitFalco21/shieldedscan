import { LAND_DOTS_HEIGHT, LAND_DOTS_WIDTH } from "./land-dots.generated";

/**
 * Equal Earth, in the node map's 1000×520 viewBox — the same constants
 * `brand/world-map-derive.py` projects the land dots with, so a node lands on the coast it
 * is on. `PROJECTION_PINS` in the generated module are four points the script projected,
 * and `map-projection.test.ts` holds this function to them: the one way the two copies of
 * the formula can drift is caught before a dot and a node disagree by a pixel.
 *
 * Equal Earth (Šavrič, Patterson & Jenny 2018) is an equal-area pseudocylindrical
 * projection: a cell of nodes in Finland and one in Kenya cover the same ground area on
 * screen, which is the property a density map needs and Mercator does not have.
 */

export const MAP_WIDTH = LAND_DOTS_WIDTH;
export const MAP_HEIGHT = LAND_DOTS_HEIGHT;

/** Equal Earth's x extent at the equator is ±2.7066 in projection units; scaled to the width. */
const SCALE = MAP_WIDTH / (2 * 2.7066);
const CX = MAP_WIDTH / 2;
const CY = MAP_HEIGHT / 2 + 10;

const A1 = 1.340264;
const A2 = -0.081106;
const A3 = 0.000893;
const A4 = 0.003796;
const M = Math.sqrt(3) / 2;

/** Projects a longitude/latitude pair to viewBox units, rounded to a tenth like the land. */
export function projectLonLat(lon: number, lat: number): readonly [number, number] {
  const lam = (lon * Math.PI) / 180;
  const phi = (lat * Math.PI) / 180;
  const theta = Math.asin(M * Math.sin(phi));
  const t2 = theta * theta;
  const t6 = t2 * t2 * t2;
  const x =
    (2 * Math.sqrt(3) * lam * Math.cos(theta)) /
    (3 * (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2)));
  const y = theta * (A1 + A2 * t2 + t6 * (A3 + A4 * t2));
  return [round1(CX + x * SCALE), round1(CY - y * SCALE)];
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
