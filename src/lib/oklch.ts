/**
 * OKLCH → sRGB, and WCAG contrast — the arithmetic the theme tests measure with.
 *
 * Pure, dependency-free, and not imported at runtime (the browser converts `oklch()` itself).
 * It lets a test compute, for every theme hue, the painted colour and its contrast ratio, so
 * palette accessibility is a tested property.
 *
 * The matrices are Björn Ottosson's published OKLab ↔ linear-sRGB constants. Out-of-gamut
 * results are clipped per channel; browsers gamut-map more carefully, but clipping is the
 * conservative side for a contrast check (it never brightens a dark colour).
 */

export interface Oklch {
  /** Lightness, 0–1. */
  l: number;
  /** Chroma, ≥ 0. */
  c: number;
  /** Hue in degrees. */
  h: number;
}

/** sRGB channels, 0–255, already gamma-encoded and clipped. */
export type Rgb255 = readonly [number, number, number];

function linearToGamma(v: number): number {
  const c = Math.min(1, Math.max(0, v));
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

export function oklchToSrgb({ l, c, h }: Oklch): Rgb255 {
  const hr = (h * Math.PI) / 180;
  const a = c * Math.cos(hr);
  const b = c * Math.sin(hr);

  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;

  const L = l_ * l_ * l_;
  const M = m_ * m_ * m_;
  const S = s_ * s_ * s_;

  const r = 4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S;
  const g = -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S;
  const bl = -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S;

  const to255 = (v: number) => Math.round(linearToGamma(v) * 255);
  return [to255(r), to255(g), to255(bl)];
}

export function srgbToHex([r, g, b]: Rgb255): string {
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

/** WCAG 2 relative luminance of a gamma-encoded sRGB colour. */
export function relativeLuminance([r, g, b]: Rgb255): number {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** WCAG 2 contrast ratio, ≥ 1. Order of arguments does not matter. */
export function contrastRatio(a: Rgb255, b: Rgb255): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
