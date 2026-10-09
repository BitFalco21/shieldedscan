import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readStylesheet } from "@/__tests__/read-stylesheet";
import { contrastRatio, oklchToSrgb } from "../oklch";
import { THEMES, deriveTokens, themeById } from "../theme";

/**
 * Amber as a theme collides with amber as a meaning: chart series and warnings are amber, so
 * under an amber accent a series line would match the links and a warning would stop
 * standing out. Two role tokens, `--series` and `--warn`, are amber by default and remapped
 * under `data-theme="amber"`. These tests pin that nothing in `src/` reaches for amber
 * directly, and that the remapped values still clear AA.
 */

const SRC = resolve(process.cwd(), "src");
const css = readStylesheet();

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "__tests__" || name === "__fixtures__") continue;
      walk(p, out);
    } else if (/\.(tsx?|css)$/.test(name)) out.push(p);
  }
  return out;
}

/** Files allowed to name amber directly: the token definitions, and the page that documents them. */
const ALLOWED = new Set([
  join(SRC, "app/styles/tokens.css"),
  join(SRC, "features/brand/BrandPage.tsx"),
]);

describe("amber is a value, series and warn are the roles", () => {
  it("no component or page reaches for amber directly — they use --series or --warn", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      if (ALLOWED.has(file)) continue;
      const text = readFileSync(file, "utf8");
      const hits = text.match(
        /text-amber[a-z-]*|bg-amber[a-z-]*|border-amber[a-z-]*|var\(--amber[a-z-]*\)/g,
      );
      if (hits) offenders.push(`${file.slice(SRC.length + 1)}: ${[...new Set(hits)].join(", ")}`);
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("globals.css defines the role tokens as amber by default", () => {
    expect(css).toMatch(/^\s*--series: var\(--amber\);/m);
    expect(css).toMatch(/^\s*--warn: var\(--amber\);/m);
    expect(css).toMatch(/^\s*--warn-edge: var\(--amber-edge\);/m);
    expect(css).toMatch(/^\s*--warn-wash: var\(--amber-wash\);/m);
    for (const name of ["series", "warn", "warn-edge", "warn-wash"]) {
      expect(css, `--color-${name} not exposed to Tailwind`).toMatch(
        new RegExp(`--color-${name}: var\\(--${name}\\);`),
      );
    }
  });

  it("the amber theme exists and remaps BOTH roles away from its own accent", () => {
    const amber = themeById("amber");
    const block = css.match(/:root\[data-theme="amber"\]\s*\{([^}]*)\}/);
    expect(block, 'no :root[data-theme="amber"] block').not.toBeNull();
    expect(block![1]).toMatch(new RegExp(`--h:\\s*${amber.hue};`));
    expect(block![1]).toMatch(/--series:\s*oklch\(/);
    expect(block![1]).toMatch(/--warn:\s*oklch\(/);
    expect(block![1]).toMatch(/--warn-edge:\s*oklch\(/);
    expect(block![1]).toMatch(/--warn-wash:\s*oklch\(/);
  });

  it("the remapped series and warn colours still clear AA on the amber theme's panel", () => {
    const panel = oklchToSrgb(deriveTokens(themeById("amber").hue).panel);
    const block = css.match(/:root\[data-theme="amber"\]\s*\{([^}]*)\}/)?.[1] ?? "";
    const read = (name: string) => {
      const m = block.match(new RegExp(`--${name}:\\s*oklch\\(([0-9.]+) ([0-9.]+) ([0-9.]+)\\)`));
      expect(m, `--${name} must be a plain oklch(L C H) literal in the amber block`).not.toBeNull();
      return oklchToSrgb({ l: Number(m![1]), c: Number(m![2]), h: Number(m![3]) });
    };
    expect(contrastRatio(read("series"), panel)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(read("warn"), panel)).toBeGreaterThanOrEqual(4.5);
  });

  it("every theme stays clear of red, so a negative delta never reads as the accent", () => {
    // Red sits at ~25°. A theme whose accent lands within 30° of it would make the one
    // colour that means "negative" indistinguishable from links and titles.
    for (const t of THEMES) {
      const d = Math.abs(((t.hue - 25 + 540) % 360) - 180);
      expect(d, `${t.id} at ${t.hue}° is within 30° of red`).toBeGreaterThan(30);
    }
  });
});

describe("the ranked inks stay apart from the accent and readable, on every theme", () => {
  const literal = (block: string, name: string) => {
    const m = block.match(new RegExp(`--${name}:\\s*oklch\\(([0-9.]+) ([0-9.]+) ([0-9.]+)\\)`));
    return m ? { l: Number(m[1]), c: Number(m[2]), h: Number(m[3]) } : null;
  };
  const root = css.match(/:root\s*\{([^}]*)\}/)?.[1] ?? "";
  const amberBlock = css.match(/:root\[data-theme="amber"\]\s*\{([^}]*)\}/)?.[1] ?? "";
  const hueGap = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

  it("defines both as plain oklch literals and exposes them to Tailwind", () => {
    for (const name of ["line-2", "line-3"]) {
      expect(literal(root, name), `--${name} in :root`).not.toBeNull();
      expect(css).toMatch(new RegExp(`--color-${name}: var\\(--${name}\\);`));
    }
  });

  it("keeps --line-2 a hue apart from each theme's accent, and --line-3 a neutral", () => {
    for (const t of THEMES) {
      const line2 = (t.id === "amber" && literal(amberBlock, "line-2")) || literal(root, "line-2")!;
      expect(hueGap(line2.h, t.hue), `--line-2 against ${t.id}`).toBeGreaterThan(60);
    }
    // A near-grey cannot be mistaken for a saturated accent, whatever its hue.
    expect(literal(root, "line-3")!.c).toBeLessThan(0.05);
  });

  it("draws both at 3:1 or better against each theme's panel, the bar for a chart line", () => {
    for (const t of THEMES) {
      const panel = oklchToSrgb(deriveTokens(t.hue).panel);
      const line2 = (t.id === "amber" && literal(amberBlock, "line-2")) || literal(root, "line-2")!;
      for (const [name, ink] of [
        ["line-2", line2],
        ["line-3", literal(root, "line-3")!],
      ] as const) {
        expect(contrastRatio(oklchToSrgb(ink), panel), `--${name} on ${t.id}`).toBeGreaterThan(3);
      }
    }
  });
});
