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

  it("keeps its darkest band visible on the panel, at 2:1 or more", () => {
    const panel = luminance("#0a120a");
    expect((luminance(ramp.at(-1)!) + 0.05) / (panel + 0.05)).toBeGreaterThanOrEqual(2);
  });

  it("colours every band class, legend swatch and area alike, from its token", () => {
    COIN_AGE_BANDS.forEach((b, i) => {
      const cls = AGE_BAND_CLASS[b.key];
      expect(css).toMatch(new RegExp(`\\.${cls} \\{\\s*color: var\\(--age-${i + 1}\\);`));
    });
  });
});
