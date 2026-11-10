import { describe, expect, it } from "vitest";
import { readStylesheet } from "@/__tests__/read-stylesheet";
import { COIN_AGE_BANDS } from "@/domain/coin-age";
import { AGE_BAND_CLASS } from "../coin-age-series";

const css = readStylesheet();

/** WCAG relative luminance of a hex colour. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

const ramp = COIN_AGE_BANDS.map((_, i) => {
  const m = css.match(new RegExp(`--age-${i + 1}: (#[0-9a-f]{6});`));
  expect(m, `--age-${i + 1} is not a hex token`).not.toBeNull();
  return m![1]!;
});

describe("coin age ramp", () => {
  it("starts at the accent green for the youngest band", () => {
    expect(ramp[0]).toBe("#2bff64");
  });

  it("darkens at every step, so the order reads without the hue", () => {
    for (let i = 1; i < ramp.length; i += 1) {
      expect(luminance(ramp[i]!)).toBeLessThan(luminance(ramp[i - 1]!));
    }
  });

  it("clears 3:1 on the panel as drawn: each band at the chart's band opacity over the panel", () => {
    // The opacity is read from the `.chart-band` rule, so the test follows the stylesheet.
    const opacity = Number(/\.chart-band \{\s*opacity: ([\d.]+);/.exec(css)![1]);
    expect(opacity).toBeGreaterThan(0);
    const panel = css.match(/--panel: (#[0-9a-f]{6});/)![1]!;
    const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const drawn = (hex: string) =>
      "#" +
      channels(hex)
        .map((c, i) => Math.round(opacity * c + (1 - opacity) * channels(panel)[i]!))
        .map((c) => c.toString(16).padStart(2, "0"))
        .join("");
    const ratio = (a: string, b: string) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (hi! + 0.05) / (lo! + 0.05);
    };
    for (const token of ramp) expect(ratio(drawn(token), panel)).toBeGreaterThanOrEqual(3);
  });

  it("colours every band class, legend swatch and area alike, from its token", () => {
    COIN_AGE_BANDS.forEach((b, i) => {
      const cls = AGE_BAND_CLASS[b.key];
      expect(css).toMatch(new RegExp(`\\.${cls} \\{\\s*color: var\\(--age-${i + 1}\\);`));
    });
  });
});
