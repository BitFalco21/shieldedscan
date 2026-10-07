import { describe, expect, it } from "vitest";
import { readStylesheet } from "@/__tests__/read-stylesheet";
import { OG_BRAND_COLORS } from "../og-brand-colors";

/**
 * The compare card's brand colours against the site's own `.brand-*` rules. satori resolves
 * no classes, so the card carries hex literals; each is held against the `globals.css` rule
 * `ChainLogo` would apply, so a copy cannot drift.
 */
const CSS = readStylesheet();

function cssBrandColor(key: string): string | undefined {
  const m = new RegExp(`\\.brand-${key}\\s*\\{\\s*color:\\s*(#[0-9a-fA-F]{6});`).exec(CSS);
  return m?.[1]?.toLowerCase();
}

describe("the compare card's brand colours", () => {
  it("match globals.css rule for rule", () => {
    for (const [key, hex] of Object.entries(OG_BRAND_COLORS)) {
      expect(cssBrandColor(key), `.brand-${key} is not in globals.css`).toBeDefined();
      expect(hex.toLowerCase(), `the card's ${key} has drifted from .brand-${key}`).toBe(
        cssBrandColor(key),
      );
    }
  });
});
