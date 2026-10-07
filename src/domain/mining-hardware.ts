/**
 * The Equihash ASICs the `/mining-cost` page can price a kilowatt-hour against.
 *
 * Every entry is a manufacturer's published specification, with the page it was read from
 * and the day it was read. The efficiency figure divides into every cost on the page, so an
 * unverified machine is left out.
 *
 * `wallWatts` is power at the wall as Bitmain states it (their sheets quote ±10%), so the
 * derived J/kSol includes supply losses. Efficiency is derived by {@link joulesPerKsol}, never
 * stored.
 */
export interface MiningHardware {
  readonly id: string;
  readonly name: string;
  /** Rated Equihash solution rate, in thousands of solutions per second. */
  readonly kSolPerSecond: number;
  /** Rated power at the wall, in watts. */
  readonly wallWatts: number;
  /** Where the two figures above were read. */
  readonly source: string;
  /** The UTC day that page was actually read. Never bumped without re-reading it. */
  readonly verifiedOn: string;
}

export const MINING_HARDWARE: readonly MiningHardware[] = [
  {
    id: "z15-pro",
    name: "Antminer Z15 Pro",
    kSolPerSecond: 840,
    wallWatts: 2780,
    source: "https://shop.bitmain.com/product/detail?pid=00020230314151716296U3dJ4g2E0662",
    verifiedOn: "2026-09-05",
  },
  {
    id: "z15",
    name: "Antminer Z15",
    kSolPerSecond: 420,
    wallWatts: 1510,
    source: "https://shop.bitmain.com/product/detail?pid=00020200609161532905yZNDBhGY0618",
    verifiedOn: "2026-09-05",
  },
];

/** The machine every figure on the page is stated for unless the reader picks another. */
export const DEFAULT_MINING_HARDWARE: MiningHardware = MINING_HARDWARE[0]!;

/** Joules per thousand solutions — the one efficiency figure the cost formula consumes. */
export function joulesPerKsol(hardware: MiningHardware): number {
  return hardware.wallWatts / hardware.kSolPerSecond;
}
