import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The flow palette (`--flow-1` … `--flow-9`, `flow-rest`) is for charts.
 *
 * It is categorical — jewel tones spaced round the wheel so ribbons and bands can be told
 * apart — and ignores the theme hue, so on chrome it reads as a second design system. Only the
 * files below may name a flow colour, and each must still use one so the list cannot become a
 * blanket exemption. The one chrome exception is the Zcash-name history, whose badges tell
 * seven actions apart by hue through `Badge`'s `hue` tone.
 */

const SRC = resolve(process.cwd(), "src");

/** Chart, Sankey, palette and ecosystem-map files: the palette's legitimate users. */
const ALLOWED = new Set([
  "lib/flow-palette.ts",
  "lib/pulse-palette.ts",
  "lib/pool-palette.ts",
  "features/mining/MiningPage.tsx",
  "features/network/topology/sky-palette.ts",
  "features/ecosystem/StageCard.tsx",
  "features/ecosystem/StageScene.tsx",
  "features/ecosystem/EcosystemList.tsx",
  // The categorical badge tone, and its one user.
  "components/Badge.tsx",
  "features/name/NamePage.tsx",
]);

/** A literal flow class (`flow-2`, `flow-rest`), a built one (`flow-${n}`), or the variable. */
const FLOW_RE = /(?<![A-Za-z0-9_-])flow-(?:\d|rest\b|\$\{)|--flow-/;

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
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

const users = walk(SRC)
  .filter((file) => FLOW_RE.test(withoutComments(readFileSync(file, "utf8"))))
  .map((file) => relative(SRC, file).split("\\").join("/"));

describe("the flow palette stays in charts", () => {
  it("is named only by chart, Sankey, palette and ecosystem-map files", () => {
    const outside = users.filter((file) => !ALLOWED.has(file));
    expect(outside, `flow colours outside charts:\n${outside.join("\n")}`).toEqual([]);
  });

  it("names no file in the allowlist that no longer uses the palette", () => {
    const stale = [...ALLOWED].filter((file) => !users.includes(file));
    expect(stale, `allowlisted but unused:\n${stale.join("\n")}`).toEqual([]);
  });
});
