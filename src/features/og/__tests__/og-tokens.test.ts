import { describe, expect, it } from "vitest";
import { readStylesheet } from "@/__tests__/read-stylesheet";
import { OG, OG_TOKEN_NAMES } from "../og-tokens";

/**
 * The share card's palette against the site's own. satori resolves no CSS variables, so the
 * card carries hex literals; each is held against the hex fallback inside `globals.css`'s
 * `@supports not (color: oklch(...))` block so the copy cannot drift.
 */
const CSS = readStylesheet();

/** The declarations inside the OKLCH fallback block, as `--token` → `#hex`. */
function fallbackPalette(): Record<string, string> {
  const block = /@supports not \(color: oklch\([^)]*\)\) \{\s*:root \{([^}]*)\}/.exec(CSS);
  if (!block) throw new Error("the @supports OKLCH fallback block is gone from globals.css");
  const out: Record<string, string> = {};
  for (const [, name, hex] of block[1]!.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{3,8});/g)) {
    out[name!] = hex!.toLowerCase();
  }
  return out;
}

describe("the share card's palette", () => {
  it("matches globals.css token for token", () => {
    const palette = fallbackPalette();
    for (const [key, hex] of Object.entries(OG)) {
      const token = OG_TOKEN_NAMES[key as keyof typeof OG];
      expect(palette[token], `${token} is not in the OKLCH fallback block`).toBeDefined();
      expect(hex, `the card's ${key} has drifted from ${token}`).toBe(palette[token]);
    }
  });

  it("names a real token for every colour it carries", () => {
    // A key with no token name could drift silently, since the assertion above iterates the
    // colours and would simply skip it.
    expect(Object.keys(OG).sort()).toEqual(Object.keys(OG_TOKEN_NAMES).sort());
  });
});
