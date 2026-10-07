import type { ReactNode } from "react";

export interface StatFigureProps {
  /** The number itself, already formatted. Null renders the unavailable state. */
  value: ReactNode;
  /** A currency sign, set small and dim before the figure. */
  sigil?: string;
  /** A unit, set small and dim after it. */
  unit?: string;
}

/**
 * The page's one statement: a figure rendered as a phosphor readout, one of the few hero
 * surfaces allowed a scanline raster (never over data).
 *
 * Built as a real colour plus an `::after` overlay, never `background-clip: text`: that needs
 * `color: transparent`, which `e2e/a11y.spec.ts` would read as black on near-black. The glyph
 * carries its own token colour; the raster is decoration on top of it.
 *
 * The raster is finer and fainter than `.crt-title`'s because this figure is about twice its
 * size: an em-relative band grows with the type and would eat the thin joins on 8 and 9.
 */
export function StatFigure({ value, sigil, unit }: StatFigureProps) {
  return (
    <p className="stat-figure">
      {sigil ? <span className="stat-figure-affix">{sigil}</span> : null}
      <span>{value}</span>
      {unit ? <span className="stat-figure-affix stat-figure-unit">{unit}</span> : null}
    </p>
  );
}
