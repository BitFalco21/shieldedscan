import type { Rgb255 } from "@/lib/oklch";

/**
 * Colour-difference arithmetic for chart palette tests: OKLab ΔE×100 under normal vision and
 * under simulated colour-vision deficiency, with the thresholds they are judged by.
 *
 * Ported from the data-viz palette validator (`validate_palette.js`): the Machado, Oliveira &
 * Fernandes (2009) severity-1.0 transforms in linear sRGB, then Euclidean distance in OKLab ×100.
 * The thresholds are calibrated to that simulation, so the two travel together.
 */

/** ΔE×100 two series should keep under protan and deutan simulation. */
export const CVD_TARGET = 8;
/** Below the target down to this floor, a pair is legal only with a secondary encoding. */
export const CVD_FLOOR = 6;
/** ΔE×100 two series must keep under normal vision; no secondary encoding excuses less. */
export const NORMAL_FLOOR = 15;
/** WCAG contrast a chart mark keeps against its surface. */
export const MARK_CONTRAST = 3;

export type Vision = "protan" | "deutan" | "tritan";

type Matrix = readonly [readonly number[], readonly number[], readonly number[]];

const MACHADO: Record<Vision, Matrix> = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

type Vec3 = [number, number, number];

const toLinear = (rgb: Rgb255): Vec3 =>
  rgb.map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as Vec3;

function oklab([r, g, b]: Vec3): Vec3 {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function simulate(rgb: Vec3, vision: Vision): Vec3 {
  const m = MACHADO[vision];
  const clamp = (c: number) => Math.max(0, Math.min(1, c));
  return m.map((row) => clamp(row[0]! * rgb[0] + row[1]! * rgb[1] + row[2]! * rgb[2])) as Vec3;
}

/** OKLab distance ×100 between two colours, under normal vision or a simulated deficiency. */
export function deltaE(a: Rgb255, b: Rgb255, vision?: Vision): number {
  const [la, lb] = [toLinear(a), toLinear(b)].map((c) =>
    oklab(vision === undefined ? c : simulate(c, vision)),
  ) as [Vec3, Vec3];
  return 100 * Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
}

/** The worse of protan and deutan: the red-green deficiencies, by far the most common. */
export const cvdDeltaE = (a: Rgb255, b: Rgb255): number =>
  Math.min(deltaE(a, b, "protan"), deltaE(a, b, "deutan"));

export function hexToRgb(hex: string): Rgb255 {
  const h = hex.replace(/^#/, "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}
