import { describe, expect, it, vi } from "vitest";

/**
 * robots.txt must let crawlers fetch the site icons. Next serves them with a hash query
 * (`/icon.png?icon.<hash>.png`), which the `/*?` rule would otherwise block, and services
 * that show favicons fetch them through Google. Checked with Google's precedence rule (the
 * longest matching pattern wins, Allow on a tie) rather than by string matching.
 */

vi.mock("@/lib/site", () => ({ isPublicStage: true, siteUrl: "https://shieldedscan.xyz" }));
vi.mock("@/lib/network", () => ({ isTestnet: false }));

function toRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

/** Google's rule: the most specific (longest) matching pattern decides; Allow wins a tie. */
function allowed(path: string, allow: string[], disallow: string[]): boolean {
  const best = (patterns: string[]) =>
    Math.max(-1, ...patterns.filter((p) => toRegex(p).test(path)).map((p) => p.length));
  return best(allow) >= best(disallow);
}

describe("robots.txt and the site icons", () => {
  it("lets a crawler fetch the hashed icon URLs while still blocking filtered lists", async () => {
    const { default: robots } = await import("../robots");
    const rules = robots().rules;
    const rule = Array.isArray(rules) ? rules[0]! : rules;
    const allow = ([] as string[]).concat(rule.allow ?? []);
    const disallow = ([] as string[]).concat(rule.disallow ?? []);

    expect(allowed("/icon.png?icon.0xsjmnjbqtrpj.png", allow, disallow)).toBe(true);
    expect(allowed("/apple-icon.png?apple-icon.0147s12owf-cr.png", allow, disallow)).toBe(true);
    expect(allowed("/", allow, disallow)).toBe(true);
    // The rules the icons must not loosen.
    expect(allowed("/blocks?page=2", allow, disallow)).toBe(false);
    expect(allowed("/tx/abc", allow, disallow)).toBe(false);
    expect(allowed("/social/card/daily/2026-10-01", allow, disallow)).toBe(false);
  });
});
