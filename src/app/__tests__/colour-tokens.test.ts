import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readStylesheet } from "@/__tests__/read-stylesheet";

/**
 * Every colour utility named after one of the site's token families must resolve to a token
 * Tailwind knows. A utility whose colour is not in `@theme inline` does not fail the build —
 * Tailwind emits no rule and the element inherits instead — so this reads the source.
 *
 * Tailwind's default palette shades (`green-500`, `red-400`) fail too: they render, but off
 * this palette.
 */

const SRC = resolve(process.cwd(), "src");
const css = readStylesheet();

const FAMILIES = [
  "ink",
  "green",
  "amber",
  "series",
  "warn",
  "red",
  "edge",
  "panel",
  "bg",
  "hairline",
  "flow",
  "brand",
  "net",
];

const UTILITIES = [
  "text",
  "bg",
  "border",
  "border-x",
  "border-y",
  "border-t",
  "border-r",
  "border-b",
  "border-l",
  "border-s",
  "border-e",
  "fill",
  "stroke",
  "from",
  "to",
  "via",
  "ring",
  "outline",
  "decoration",
  "divide",
];

/** The `--color-*` names exposed to Tailwind by the `@theme inline` block. */
function declaredColours(stylesheet: string): Set<string> {
  const block = stylesheet.match(/@theme inline\s*\{([\s\S]*?)\n\}/);
  if (block === null) throw new Error("globals.css has no `@theme inline { … }` block");
  return new Set([...block[1]!.matchAll(/--color-([a-z0-9-]+)\s*:/g)].map((m) => m[1]!));
}

/** Comments are prose; a class named in one is not a class used. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const UTILITY_RE = new RegExp(
  String.raw`(?<![A-Za-z0-9_\-\[])(?:${UTILITIES.join("|")})-((?:${FAMILIES.join(
    "|",
  )})(?:-[a-z0-9]+)*)(?:\/(?:\d+|\[[^\]\s]+\]))?(?![A-Za-z0-9_\-])`,
  "g",
);

/** Every family-named colour utility in `source` whose colour is not declared. */
function undeclaredColourUtilities(source: string, declared: Set<string>): string[] {
  const out: string[] = [];
  for (const match of withoutComments(source).matchAll(UTILITY_RE)) {
    if (!declared.has(match[1]!)) out.push(match[0]);
  }
  return out;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "__tests__" || name === "__fixtures__") continue;
      walk(p, out);
    } else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe("colour utilities resolve to a declared token", () => {
  const declared = declaredColours(css);

  it("every family-named colour utility in src/ has a --color-* in @theme inline", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const hits = undeclaredColourUtilities(readFileSync(file, "utf8"), declared);
      if (hits.length > 0) {
        offenders.push(`${file.slice(SRC.length + 1)}: ${[...new Set(hits)].join(", ")}`);
      }
    }
    expect(offenders, `utilities with no token:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("catches the shape that shipped: border-hairline before --color-hairline existed", () => {
    // Proof the matcher bites: a theme block without `hairline`, and a class that uses it.
    const before = new Set([...declared].filter((name) => name !== "hairline"));
    const satoshi = `<div className="border-b border-hairline last:border-0" />`;
    expect(undeclaredColourUtilities(satoshi, before)).toEqual(["border-hairline"]);
    expect(undeclaredColourUtilities(satoshi, declared)).toEqual([]);
  });

  it("reads variants, opacity and side borders, and leaves comments and other words alone", () => {
    const tokens = new Set(["ink-dim", "edge-faint", "green"]);
    expect(
      undeclaredColourUtilities(
        `"hover:text-ink-dim border-t-edge-faint/60 bg-green/[0.3] text-ink-faintis-unavailable"`,
        tokens,
      ),
    ).toEqual(["text-ink-faintis-unavailable"]);
    // The formatter trap above is caught; prose and non-family words are not.
    expect(undeclaredColourUtilities(`/* text-ink-nope */ "go-to-red text-sm"`, tokens)).toEqual(
      [],
    );
    // Tailwind's default shades render, but off this palette: they fail too.
    expect(undeclaredColourUtilities(`"text-green-500"`, tokens)).toEqual(["text-green-500"]);
  });
});
